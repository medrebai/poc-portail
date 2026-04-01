"""
generate-fix-suggestions.py
============================
Reads bpa-results.json + pbi-inspector-results.json, enriches DAX violations
with actual expressions parsed from TMDL files, then calls Gemini to generate
contextual fix suggestions. Writes fix-suggestions.json.

Usage:
    python generate-fix-suggestions.py \
        --bpa-results     ./ci-tools/bpa-results.json \
        --inspector-results ./ci-tools/pbi-inspector-results.json \
        --tmdl-dir        "./VORTEX - DATASET - HR VUE.SemanticModel/definition/tables" \
        --output          ./ci-tools/fix-suggestions.json

Requirements:
    pip install google-generativeai

API Key:
    Set environment variable: GEMINI_API_KEY=your_key_here
    Get a free key at: https://aistudio.google.com/app/apikey
"""

import json
import os
import re
import argparse
import sys
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

# Rules where LLM adds real value (DAX rewrites + complex visual context)
LLM_RULES = {
    # BPA — DAX rules
    "DAX_DIVISION_COLUMNS",
    "DAX_COLUMNS_FULLY_QUALIFIED",
    "DAX_MEASURES_UNQUALIFIED",
    # BPA — Float type (context-sensitive explanation of precision impact)
    "META_AVOID_FLOAT",
    # Inspector — complex setting diff
    "LOCAL_REPORT_SETTINGS",
    # Inspector — contextual visual fix
    "PERCENTAGE_OF_CHARTS_USING_CUSTOM_COLOURS",
    "SHOW_AXES_TITLES",
}

# Rules handled by hardcoded templates — skip LLM entirely
SKIP_RULES = {
    "UPPERCASE_FIRST_LETTER_COLUMNS_HIERARCHIES",
    "UPPERCASE_FIRST_LETTER_MEASURES_TABLES",
    "APPLY_FORMAT_STRING_COLUMNS",
    "APPLY_FORMAT_STRING_MEASURES",
    "DISABLE_AUTO_DATE_TIME",
    "DIABLE_AUTO_DATE/TIME",   # old typo version — handle both during transition
    "PERF_UNUSED_COLUMNS",
    "PERF_UNUSED_MEASURES",
    "RELATIONSHIP_COLUMN_NAMES",
    "CHARTS_WIDER_THAN_TALL",
    "MOBILE_CHARTS_WIDER_THAN_TALL",
    "CHECK_FOR_VISUALS_OVERLAP",
    "GIVE_VISIBLE_PAGES_MEANINGFUL_NAMES",
    "ACTIVE_PAGE",
    "NO_CAMELCASE_COLUMNS_HIERARCHIES",
    "NO_CAMELCASE_MEASURES_TABLES",
    "LAYOUT_COLUMNS_HIERARCHIES_DF",
    "LAYOUT_MEASURES_DF",
    "AVOID_SINGLE_ATTRIBUTE_DIMENSIONS",
}


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — TMDL PARSER
# Extracts measure name → DAX expression from all *.tmdl table files.
# Handles both single-line and backtick-fenced multiline expressions.
# ─────────────────────────────────────────────────────────────────────────────

def parse_tmdl_directory(tmdl_dir: str) -> dict:
    """
    Returns: { "MeasureName": "DAX expression string", ... }
    Covers measures and calculated columns.
    """
    catalog = {}
    tmdl_path = Path(tmdl_dir)

    if not tmdl_path.exists():
        print(f"[WARN] TMDL directory not found: {tmdl_dir}")
        return catalog

    tmdl_files = list(tmdl_path.glob("*.tmdl"))
    if not tmdl_files:
        print(f"[WARN] No .tmdl files found in: {tmdl_dir}")
        return catalog

    for tmdl_file in tmdl_files:
        try:
            content = tmdl_file.read_text(encoding="utf-8")
            _parse_tmdl_content(content, catalog)
        except Exception as e:
            print(f"[WARN] Could not parse {tmdl_file.name}: {e}")

    print(f"[INFO] Parsed {len(catalog)} DAX objects from {len(tmdl_files)} TMDL files")
    return catalog


def _parse_tmdl_content(content: str, catalog: dict):
    """
    Parses a single TMDL file content and fills the catalog dict.
    Handles three expression formats found in TMDL:

    1. Single-line:
       measure 'Revenue MTD' = TOTALMTD([Revenue], 'Dim Date'[Day])

    2. Multiline (indented, no backticks):
       measure Turnover =
               VAR x = ...
               RETURN x

    3. Backtick-fenced multiline:
       measure 'Occupation Rate' = ```
               VAR x = ...
               RETURN x
               ```
    """
    lines = content.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Match: measure 'Name' = ... or measure Name = ...
        measure_match = re.match(
            r"^\s*measure\s+'([^']+)'\s*=\s*(.*)|^\s*measure\s+(\S+)\s*=\s*(.*)",
            line
        )
        # Match: column 'Name' (calculated columns don't have = on the same line usually,
        # but CalculatedColumn source is defined differently — measures are the priority)
        
        if measure_match:
            # Extract name and inline expression
            if measure_match.group(1):
                name = measure_match.group(1)
                inline = measure_match.group(2).strip()
            else:
                name = measure_match.group(3)
                inline = measure_match.group(4).strip()

            # Case 3: backtick-fenced multiline
            if inline == "```" or inline.startswith("```"):
                expr_lines = []
                i += 1
                while i < len(lines):
                    fence_line = lines[i].strip()
                    if fence_line == "```":
                        break
                    expr_lines.append(lines[i])
                    i += 1
                expression = _clean_expression("\n".join(expr_lines))

            # Case 2: empty inline → multiline indented block follows
            elif inline == "":
                expr_lines = []
                i += 1
                while i < len(lines):
                    next_line = lines[i]
                    next_stripped = next_line.strip()
                    # Stop when we hit a non-indented keyword (next property or object)
                    if next_stripped and not next_line.startswith("\t\t") and not next_line.startswith("        "):
                        break
                    # Stop at known TMDL property keywords at measure level
                    if re.match(r"^\s+(formatString|displayFolder|lineageTag|annotation|isHidden|description)\s*", next_line):
                        break
                    expr_lines.append(next_line)
                    i += 1
                expression = _clean_expression("\n".join(expr_lines))
                continue  # don't increment i again

            # Case 1: single-line expression
            else:
                expression = _clean_expression(inline)

            if name and expression:
                catalog[name] = expression

        i += 1


def _clean_expression(raw: str) -> str:
    """Strip leading/trailing whitespace and normalize indentation."""
    lines = raw.split("\n")
    # Find minimum indentation of non-empty lines
    non_empty = [l for l in lines if l.strip()]
    if not non_empty:
        return ""
    min_indent = min(len(l) - len(l.lstrip()) for l in non_empty)
    dedented = [l[min_indent:] if len(l) >= min_indent else l for l in lines]
    return "\n".join(dedented).strip()


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — VIOLATION EXTRACTOR
# Pulls violations that need LLM from both BPA and Inspector outputs.
# ─────────────────────────────────────────────────────────────────────────────

def extract_bpa_violations(bpa_results: dict, dax_catalog: dict) -> list:
    """
    Returns list of violation dicts enriched with DAX expression where available.
    Only includes violations where ruleId is in LLM_RULES.
    Deduplicates by ruleId — we send one representative per rule to avoid
    flooding the LLM with 97 identical DAX_COLUMNS_FULLY_QUALIFIED entries.
    """
    violations = bpa_results.get("violations", [])
    seen_rules = {}

    for v in violations:
        rule_id = v.get("ruleId", "")

        if rule_id not in LLM_RULES:
            continue

        # Skip Power BI auto-generated date tables — internal objects, not editable
        raw_object_check = v.get("object", "")
        if any(p in raw_object_check for p in ("LocalDateTable_", "DateTableTemplate_")):
            continue

        if rule_id in seen_rules:
            # Just increment the count, don't add a new entry
            seen_rules[rule_id]["affectedCount"] += 1
            continue

        # Parse object name — format is usually "TableName[ObjectName]"
        raw_object = v.get("object", "")
        table_name, object_name = _parse_object_ref(raw_object)

        entry = {
            "source": "bpa",
            "ruleId": rule_id,
            "ruleName": v.get("ruleName", ""),
            "category": v.get("category", ""),
            "severity": v.get("severity", 2),
            "severityLabel": v.get("severityLabel", ""),
            "objectType": v.get("objectType", ""),
            "objectName": object_name,
            "tableName": table_name,
            "rawObject": raw_object,
            "ruleDescription": v.get("description", ""),
            "affectedCount": 1,
            "daxExpression": None,
        }

        # Enrich with DAX expression if available
        if object_name and object_name in dax_catalog:
            entry["daxExpression"] = dax_catalog[object_name]

        seen_rules[rule_id] = entry

    result = list(seen_rules.values())

    # Add total affected count from summaryByRule for context
    summary_map = {r["ruleId"]: r["count"] for r in bpa_results.get("summaryByRule", [])}
    for entry in result:
        rid = entry["ruleId"]
        if rid in summary_map:
            entry["affectedCount"] = summary_map[rid]

    return result


def extract_inspector_violations(inspector_results: dict) -> list:
    """
    Returns list of failed Inspector rules that need LLM suggestions.
    Includes expected vs actual diff for context-rich prompting.
    """
    results = inspector_results.get("Results", [])
    violations = []

    for r in results:
        if r.get("Pass", True):
            continue

        rule_id = r.get("RuleId", "")
        if rule_id not in LLM_RULES:
            continue

        violations.append({
            "source": "inspector",
            "ruleId": rule_id,
            "ruleName": r.get("RuleName", ""),
            "ruleDescription": r.get("RuleDescription", ""),
            "pageName": r.get("ParentDisplayName", "N/A"),
            "itemPath": r.get("ItemPath", ""),
            "expected": r.get("Expected"),
            "actual": r.get("Actual"),
            "message": r.get("Message", ""),
        })

    return violations


def _parse_object_ref(raw: str) -> tuple:
    """
    Parses 'TableName[ObjectName]' → ('TableName', 'ObjectName')
    Falls back to ('', raw) if format doesn't match.
    """
    match = re.match(r"^(.+?)\[(.+)\]$", raw)
    if match:
        return match.group(1), match.group(2)
    return "", raw


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — PROMPT BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def build_prompt(bpa_violations: list, inspector_violations: list) -> str:
    """
    Builds a single batched prompt with all violations.
    Returns the prompt string.
    """
    all_violations = []

    for v in bpa_violations:
        item = {
            "id": v["ruleId"],
            "source": "BPA (Semantic Model)",
            "rule": v["ruleName"],
            "category": v["category"],
            "severity": v["severityLabel"],
            "objectType": v["objectType"],
            "object": v["rawObject"],
            "affectedCount": v["affectedCount"],
            "ruleDescription": v["ruleDescription"],
        }
        if v.get("daxExpression"):
            item["daxExpression"] = v["daxExpression"]
        all_violations.append(item)

    for v in inspector_violations:
        item = {
            "id": v["ruleId"],
            "source": "PBI Inspector (Visual Layer)",
            "rule": v["ruleName"],
            "page": v["pageName"],
            "ruleDescription": v["ruleDescription"],
            "expected": v["expected"],
            "actual": v["actual"],
        }
        all_violations.append(item)

    violations_json = json.dumps(all_violations, indent=2, ensure_ascii=False)

    prompt = f"""You are a senior Power BI developer and data model expert reviewing a PBIP project.

Below are rule violations detected by automated quality tools (Tabular Editor BPA and PBI Inspector).
For each violation, provide a concise, actionable fix suggestion tailored to the specific object and context.

IMPORTANT RULES:
- For DAX violations where a daxExpression is provided, show the corrected DAX expression.
- For violations affecting many objects (affectedCount > 10), give one representative fix + note it applies to all N objects.
- Be specific — reference the actual object name, table, and expression.
- Keep each fixSuggestion under 3 sentences.
- Respond ONLY with a valid JSON array. No markdown, no explanation outside the JSON.

OUTPUT FORMAT (one object per violation):
[
  {{
    "ruleId": "RULE_ID",
    "fixSuggestion": "Plain English description of what to do.",
    "correctedExpression": "CORRECTED DAX HERE (only for DAX rules, omit otherwise)",
    "effort": "trivial | low | medium | high",
    "affectsMultiple": true/false
  }}
]

VIOLATIONS TO ANALYZE:
{violations_json}
"""
    return prompt


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — LLM CALL (Groq — free tier, no billing needed)
# ─────────────────────────────────────────────────────────────────────────────

def call_gemini(prompt: str, api_key: str) -> list:
    """
    Sends prompt to Groq (llama-3.3-70b-versatile — free, no billing needed).
    Get a free key at: https://console.groq.com
    Returns parsed list of fix suggestion dicts.
    """
    try:
        from groq import Groq
    except ImportError:
        print("[ERROR] groq not installed.")
        print("        Run: pip install groq")
        sys.exit(1)

    client = Groq(api_key=api_key)

    print("[INFO] Sending violations to Groq (llama-3.3-70b)...")
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=4096,
    )
    raw_text = response.choices[0].message.content.strip()

    # Strip markdown fences if present (safety net)
    if raw_text.startswith("```"):
        raw_text = re.sub(r"^```[a-z]*\n?", "", raw_text)
        raw_text = re.sub(r"\n?```$", "", raw_text)

    try:
        suggestions = json.loads(raw_text)
        if not isinstance(suggestions, list):
            raise ValueError("Expected a JSON array at top level")
        return suggestions
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[ERROR] Failed to parse LLM response as JSON: {e}")
        print(f"[DEBUG] Raw response:\n{raw_text[:500]}")
        return []


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — OUTPUT WRITER
# Merges suggestions back with violation metadata and writes final JSON.
# ─────────────────────────────────────────────────────────────────────────────

def build_output(bpa_violations: list, inspector_violations: list, suggestions: list) -> dict:
    """
    Merges LLM suggestions with original violation data.
    Produces a clean output structure for the portal to consume.
    """
    # Index suggestions by ruleId for fast lookup
    suggestion_map = {s["ruleId"]: s for s in suggestions}

    def enrich(violation, source_type):
        rule_id = violation["ruleId"]
        suggestion = suggestion_map.get(rule_id, {})
        return {
            "ruleId": rule_id,
            "ruleName": violation.get("ruleName", ""),
            "source": source_type,
            "severity": violation.get("severity") or violation.get("severityLabel", ""),
            "affectedCount": violation.get("affectedCount", 1),
            "object": violation.get("rawObject") or violation.get("pageName", ""),
            "daxExpression": violation.get("daxExpression"),
            "llmFixSuggestion": suggestion.get("fixSuggestion", ""),
            "correctedExpression": suggestion.get("correctedExpression"),
            "effort": suggestion.get("effort", ""),
            "affectsMultiple": suggestion.get("affectsMultiple", False),
            "llmGenerated": bool(suggestion),
        }

    enriched_bpa = [enrich(v, "bpa") for v in bpa_violations]
    enriched_inspector = [enrich(v, "inspector") for v in inspector_violations]

    return {
        "generatedAt": _now_iso(),
        "model": "groq/llama-3.3-70b-versatile",
        "totalLLMSuggestions": len(suggestions),
        "bpaFixes": enriched_bpa,
        "inspectorFixes": enriched_inspector,
    }


def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate LLM fix suggestions for BPA + PBI Inspector violations")
    parser.add_argument("--bpa-results",        default="./ci-tools/bpa-results.json")
    parser.add_argument("--inspector-results",  default="./ci-tools/pbi-inspector-results.json")
    parser.add_argument("--tmdl-dir",           default="./definition/tables")
    parser.add_argument("--output",             default="./ci-tools/fix-suggestions.json")
    args = parser.parse_args()

    # ── API Key ──────────────────────────────────────────────────────────────
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        print("[ERROR] GROQ_API_KEY environment variable not set.")
        print("        export GROQ_API_KEY=your_key_here  (Mac/Linux)")
        print("        $env:GROQ_API_KEY='your_key_here'  (PowerShell)")
        sys.exit(1)

    # ── Load inputs ──────────────────────────────────────────────────────────
    print(f"[INFO] Loading BPA results from: {args.bpa_results}")
    with open(args.bpa_results, encoding="utf-8-sig") as f:
        bpa_results = json.load(f)

    print(f"[INFO] Loading Inspector results from: {args.inspector_results}")
    with open(args.inspector_results, encoding="utf-8-sig") as f:
        inspector_results = json.load(f)

    # ── Parse TMDL ───────────────────────────────────────────────────────────
    print(f"[INFO] Parsing TMDL files from: {args.tmdl_dir}")
    dax_catalog = parse_tmdl_directory(args.tmdl_dir)

    # ── Extract violations ───────────────────────────────────────────────────
    bpa_violations = extract_bpa_violations(bpa_results, dax_catalog)
    inspector_violations = extract_inspector_violations(inspector_results)

    print(f"[INFO] LLM-worthy violations: {len(bpa_violations)} BPA, {len(inspector_violations)} Inspector")

    if not bpa_violations and not inspector_violations:
        print("[INFO] No violations require LLM suggestions. Nothing to do.")
        output = {"generatedAt": _now_iso(), "totalLLMSuggestions": 0, "bpaFixes": [], "inspectorFixes": []}
        Path(args.output).write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
        return

    # ── Build prompt & call Gemini ───────────────────────────────────────────
    prompt = build_prompt(bpa_violations, inspector_violations)
    suggestions = call_gemini(prompt, api_key)
    print(f"[INFO] Received {len(suggestions)} suggestions from Gemini")

    # ── Write output ─────────────────────────────────────────────────────────
    output = build_output(bpa_violations, inspector_violations, suggestions)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"[INFO] Fix suggestions written to: {args.output}")
    print(f"[DONE] {len(suggestions)} LLM suggestions generated successfully.")


if __name__ == "__main__":
    main()