"""
BPA Analyzer Service — runs Tabular Editor CLI and parses output.
Ported from ci-tools/run-bpa-analysis.ps1 + parse-bpa-to-json.ps1
"""

import re
import json
import subprocess
import os
from flask import current_app
from app.services.fix_matcher import build_fix_suggestion


def run_bpa(model_definition_path: str) -> dict:
    """Run Tabular Editor BPA analysis and return structured results."""
    te_path = current_app.config['TABULAR_EDITOR_PATH']
    rules_path = os.path.abspath(current_app.config['BPA_RULES_PATH'])

    if not os.path.exists(te_path):
        raise FileNotFoundError(f"Tabular Editor not found: {te_path}")
    if not os.path.exists(rules_path):
        raise FileNotFoundError(f"BPA rules not found: {rules_path}")

    # Run Tabular Editor CLI
    result = subprocess.run(
        [te_path, model_definition_path, "-A", rules_path, "-V"],
        capture_output=True, text=True, encoding='utf-8', errors='replace',
        timeout=120,
    )

    # Exit code 0 = no violations, 1 = violations found (both OK), 2+ = crash
    if result.returncode >= 2:
        raise RuntimeError(f"Tabular Editor crashed (exit {result.returncode}): {result.stderr}")

    # Some TE executions emit violations on stderr or return empty stdout.
    console_output = result.stdout or result.stderr or ''
    return parse_bpa_output(console_output, rules_path)


def parse_bpa_output(console_output: str, rules_path: str) -> dict:
    """Parse BPA console output into structured violations."""
    console_output = console_output or ''
    # Load rules
    with open(rules_path, 'r', encoding='utf-8') as f:
        rules = json.load(f)
    rule_map = {r['Name']: r for r in rules}

    auto_date_prefixes = ("LocalDateTable_", "DateTableTemplate_")
    violations = []

    for line in console_output.splitlines():
        line = line.strip()
        if not line:
            continue

        # Strip Azure DevOps log prefix when present.
        line = re.sub(r"^##vso\[task\.logissue[^\]]*\]", "", line)

        # Handles lines like: [WARNING] Measure 'Table'[Obj] violates rule "Rule" (Category)
        line = re.sub(r"^\[[^\]]+\]\s*", "", line)

        object_type = table_name = object_name = rule_name = full_object = None
        parsed_category = None

        # Pattern 1: ObjectType 'Table'[Object] violates rule "RuleName"
        # Also handles variant: Table (Import) 'TableName'[Object]
        m1 = re.match(r"^([\w\s]+?)(?:\s+\([^)]+\))?\s+'([^']+)'\[([^\]]+)\]\s+violates rule\s+\"(.+?)\"(?:\s+\((.+)\))?$", line)
        if m1:
            object_type = m1.group(1).strip()
            table_name = m1.group(2)
            object_name = m1.group(3)
            rule_name = m1.group(4)
            parsed_category = m1.group(5)
            full_object = f"{table_name}[{object_name}]"
        else:
            # Pattern 2: ObjectType 'TableName' violates rule "RuleName"
            m2q = re.match(r"^([\w\s]+?)(?:\s+\([^)]+\))?\s+'([^']+)'\s+violates rule\s+\"(.+?)\"(?:\s+\((.+)\))?$", line)
            if m2q:
                object_type = m2q.group(1).strip()
                table_name = m2q.group(2).strip()
                object_name = ""
                full_object = table_name
                rule_name = m2q.group(3)
                parsed_category = m2q.group(4)
            else:
                # Pattern 3: ObjectType ObjectName violates rule "RuleName"
                m3 = re.match(r"^([\w\s]+?)(?:\s+\([^)]+\))?\s+(.+?)\s+violates rule\s+\"(.+?)\"(?:\s+\((.+)\))?$", line)
                if m3:
                    object_type = m3.group(1).strip()
                    full_object = m3.group(2).strip()
                    rule_name = m3.group(3)
                    parsed_category = m3.group(4)

                    # Try to parse table[object] from full_object
                    m4 = re.match(r"^([^\[]+)\[([^\]]+)\]$", full_object)
                    if m4:
                        table_name = m4.group(1).strip().strip("'")
                        object_name = m4.group(2).strip()
                    else:
                        table_name = full_object.strip("'")
                        object_name = ""

        if not rule_name:
            continue

        # Skip auto-generated date tables
        if table_name and any(table_name.startswith(p) for p in auto_date_prefixes):
            continue

        # Lookup rule metadata
        rule = rule_map.get(rule_name, {})
        rule_id = rule.get('ID', 'UNKNOWN')
        severity = int(rule.get('Severity', 0))
        category = rule.get('Category') or parsed_category or 'Unknown'
        description = rule.get('Description', '')

        severity_label = {3: 'ERROR', 2: 'WARNING', 1: 'INFO'}.get(severity, 'UNKNOWN')

        # Get fix suggestion
        fix = build_fix_suggestion(
            rule_id=rule_id,
            table_name=table_name or '',
            object_name=object_name or '',
            fallback_object=full_object or '',
        )

        violations.append({
            'ruleId': rule_id,
            'ruleName': rule_name,
            'severity': severity,
            'severityLabel': severity_label,
            'category': category,
            'object': full_object,
            'objectType': object_type,
            'tableName': table_name or '',
            'objectName': object_name or '',
            'description': description,
            'suggestedFix': fix,
        })

    # Build summaries
    summary_by_severity = {}
    summary_by_rule = {}

    for v in violations:
        sev = v['severity']
        if sev not in summary_by_severity:
            summary_by_severity[sev] = {'severity': sev, 'label': v['severityLabel'], 'count': 0}
        summary_by_severity[sev]['count'] += 1

        rn = v['ruleName']
        if rn not in summary_by_rule:
            summary_by_rule[rn] = {
                'ruleName': rn,
                'ruleId': v['ruleId'],
                'severity': v['severity'],
                'severityLabel': v['severityLabel'],
                'category': v['category'],
                'count': 0,
            }
        summary_by_rule[rn]['count'] += 1

    return {
        'totalViolations': len(violations),
        'summaryBySeverity': sorted(summary_by_severity.values(), key=lambda x: x['severity'], reverse=True),
        'summaryByRule': sorted(summary_by_rule.values(), key=lambda x: x['count'], reverse=True),
        'violations': violations,
    }
