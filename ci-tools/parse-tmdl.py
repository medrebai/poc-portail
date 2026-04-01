"""
parse-tmdl.py
Parses all TMDL files in a PBIP SemanticModel and produces model-catalog.json.

What it extracts:
  - Model metadata (culture, autoDateTime, source version)
  - Tables with columns, measures, partitions (M queries + BigQuery details)
  - Relationships (excluding auto-generated date tables)
  - RLS Roles

Usage:
    python ci-tools/parse-tmdl.py
    python ci-tools/parse-tmdl.py \
        --model "VORTEX - DATASET - HR VUE.SemanticModel/definition" \
        --json  ci-tools/model-catalog.json
"""

import re
import json
import sys
import io
import argparse
from pathlib import Path

# Force UTF-8 output on Windows runners (fixes cp1252 UnicodeEncodeError)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


# ===========================================================================
# TMDL PARSERS
# ===========================================================================

def _val(text: str, key: str) -> str | None:
    """Extract a single-line value from TMDL: 'key: value'."""
    m = re.search(rf"^\s*{key}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else None


def parse_model(model_path: Path) -> dict:
    """Parse model.tmdl for model-level metadata."""
    text = model_path.read_text(encoding="utf-8-sig")
    meta = {
        "culture":                        _val(text, "culture"),
        "sourceQueryCulture":             _val(text, "sourceQueryCulture"),
        "defaultPowerBIDataSourceVersion": _val(text, "defaultPowerBIDataSourceVersion"),
        "autoDateTime":                   "__PBI_TimeIntelligenceEnabled" in text,
        "tables": []
    }
    for m in re.finditer(r"^ref table (.+)$", text, re.MULTILINE):
        name = m.group(1).strip().strip("'")
        if not name.startswith("LocalDateTable") and not name.startswith("DateTableTemplate"):
            meta["tables"].append(name)
    return meta


def parse_relationships(rel_path: Path) -> list:
    """Parse relationships.tmdl into a list of relationship dicts."""
    text  = rel_path.read_text(encoding="utf-8-sig")
    rels  = []
    blocks = re.split(r"^relationship\s+[\w-]+", text, flags=re.MULTILINE)

    for block in blocks[1:]:
        fc = _val(block, "fromColumn")
        tc = _val(block, "toColumn")
        if not fc or not tc:
            continue
        if "LocalDateTable" in tc or "DateTableTemplate" in tc:
            continue

        def split_col(expr):
            m = re.match(r"'([^']+)'\.(.+)", expr.strip())
            if m:
                return m.group(1), m.group(2)
            parts = expr.strip().split(".")
            return (parts[0], parts[1]) if len(parts) == 2 else (expr.strip(), "")

        from_table, from_col = split_col(fc)
        to_table,   to_col   = split_col(tc)

        rels.append({
            "fromTable":        from_table,
            "fromColumn":       from_col,
            "toTable":          to_table,
            "toColumn":         to_col,
            "crossFilter":      "bothDirections" if "bothDirections" in block else "singleDirection",
            "fromCardinality":  _val(block, "fromCardinality") or "many",
            "toCardinality":    _val(block, "toCardinality")   or "one",
            "isActive":         "state: inactive" not in block,
        })
    return rels


def parse_table(tmdl_path: Path) -> dict | None:
    """Parse a single table TMDL file into columns, measures, partitions."""
    text = tmdl_path.read_text(encoding="utf-8-sig")

    m = re.match(r"table\s+'?([^'\n]+)'?", text)
    table_name = m.group(1).strip() if m else tmdl_path.stem

    if table_name.startswith("LocalDateTable") or table_name.startswith("DateTableTemplate"):
        return None

    mode_m = re.search(r"mode:\s+(\w+)", text)

    result = {
        "name":       table_name,
        "isHidden":   "isHidden" in text,
        "mode":       mode_m.group(1) if mode_m else "import",
        "columns":    [],
        "measures":   [],
        "partitions": []
    }

    for block in re.split(r"\n\t(?=column\s)", text)[1:]:
        col = _parse_column(block)
        if col:
            result["columns"].append(col)

    for block in re.split(r"\n\t(?=measure\s)", text)[1:]:
        meas = _parse_measure(block)
        if meas:
            result["measures"].append(meas)

    for block in re.split(r"\n\tpartition\s+", text)[1:]:
        part = _parse_partition(table_name, block)
        if part:
            result["partitions"].append(part)

    return result


def _parse_column(block: str) -> dict | None:
    m = re.match(r"column\s+'?([^'\n]+)'?", block)
    if not m:
        return None
    name      = m.group(1).strip()
    data_type = _val(block, "dataType") or "string"
    fmt       = _val(block, "formatString")
    is_hidden = "isHidden" in block
    numeric   = {"int64", "double", "decimal", "currency"}

    return {
        "name":                name,
        "dataType":            data_type,
        "formatString":        fmt,
        "isHidden":            is_hidden,
        "displayFolder":       _val(block, "displayFolder"),
        "summarizeBy":         _val(block, "summarizeBy"),
        "sortByColumn":        _val(block, "sortByColumn"),
        "sourceColumn":        _val(block, "sourceColumn") or name,
        "isCalculated":        "calculatedColumn" in block or
                               ("dataType" in block and "expression" in block and
                                "sourceColumn" not in block),
        "missingFormatString": data_type in numeric and not fmt and not is_hidden,
        "isFloat":             data_type == "double",
    }


def _parse_measure(block: str) -> dict | None:
    m = re.match(r"measure\s+'?([^'\n=]+)'?", block)
    if not m:
        return None
    name      = m.group(1).strip()
    fmt       = _val(block, "formatString")
    dtype     = _val(block, "dataType") or ""
    is_hidden = "isHidden" in block

    dax = ""
    dax_m = re.search(r"=\s*\n?([\s\S]+?)(?=\n\t\t\w|\n\t\w|$)", block)
    if dax_m:
        dax = re.sub(r"\n\t+", "\n", dax_m.group(1)).strip()

    numeric     = {"int64", "double", "decimal", "currency", ""}
    missing_fmt = not fmt and not is_hidden and dtype.lower() in numeric

    return {
        "name":                name,
        "dataType":            dtype,
        "formatString":        fmt,
        "displayFolder":       _val(block, "displayFolder"),
        "isHidden":            is_hidden,
        "expression":          dax[:500] + ("..." if len(dax) > 500 else ""),
        "missingFormatString": missing_fmt,
    }


def _parse_partition(table_name: str, block: str) -> dict:
    """Extract M query and BigQuery metadata from a partition block."""
    name_m     = re.match(r"'?([^'\n=]+)'?\s*=\s*(\w+)", block)
    part_name  = name_m.group(1).strip() if name_m else table_name
    query_type = name_m.group(2).strip() if name_m else "m"
    mode_m     = re.search(r"mode:\s+(\w+)", block)
    mode       = mode_m.group(1) if mode_m else "import"

    m_query = ""
    src_m = re.search(r"source\s*=\s*\n([\s\S]+?)(?=\n\tannotation|\n\tref |\Z)", block)
    if src_m:
        lines   = src_m.group(1).split("\n")
        m_query = "\n".join(re.sub(r"^\t{3}", "", l) for l in lines).strip()

    datasource = "Unknown"
    bq_project = bq_dataset = bq_table = sql_query = ""

    if "GoogleBigQuery" in block:
        datasource = "Google BigQuery"
        bq_m = re.search(r"BillingProject\s*=\s*([^\]]+)\]", block)
        bq_project = bq_m.group(1).strip() if bq_m else ""
        sql_m = re.search(r'Value\.NativeQuery\([^,]+,\s*"([\s\S]+?)",\s*null', block)
        if sql_m:
            sql_query = sql_m.group(1).strip()
            tbl_m = re.search(r'FROM\s+`[^.]+\.([^.]+)\.([^`]+)`', sql_query)
            if tbl_m:
                bq_dataset = tbl_m.group(1)
                bq_table   = tbl_m.group(2)
    elif "Sql.Database" in block or "Value.NativeQuery" in block:
        datasource = "SQL Server"
    elif "Excel.Workbook" in block:
        datasource = "Excel"
    elif "SharePoint" in block:
        datasource = "SharePoint"
    elif "Web.Contents" in block:
        datasource = "Web/API"
    elif "expression" in block.lower() and "let" not in block.lower():
        datasource = "Calculated Table (DAX)"
        query_type = "calculated"

    step_patterns = [
        (r"Table\.NestedJoin",           "Join"),
        (r"Table\.ExpandTableColumn",    "Expand columns"),
        (r"Table\.AddColumn",            "Add column"),
        (r"Table\.TransformColumnTypes", "Transform types"),
        (r"Table\.RenameColumns",        "Rename columns"),
        (r"Table\.RemoveColumns",        "Remove columns"),
        (r"Table\.FilterRows",           "Filter rows"),
        (r"Table\.SelectRows",           "Select rows"),
        (r"Table\.Group",                "Group"),
        (r"Table\.Pivot",                "Pivot"),
        (r"Table\.UnpivotOtherColumns",  "Unpivot"),
    ]
    transformations = []
    seen = set()
    for pattern, label in step_patterns:
        if re.search(pattern, block) and label not in seen:
            transformations.append(label)
            seen.add(label)

    let_steps = len(re.findall(r"^\s+#?\"[^\"]+\"\s*=", m_query, re.MULTILINE))

    return {
        "partitionName":   part_name,
        "queryType":       query_type,
        "mode":            mode,
        "datasource":      datasource,
        "bqProject":       bq_project,
        "bqDataset":       bq_dataset,
        "bqTable":         bq_table,
        "sqlQuery":        sql_query,
        "transformations": transformations,
        "stepCount":       let_steps,
        "mQuery":          m_query,
    }


def parse_roles(roles_dir: Path) -> list:
    """Parse all .tmdl files in definition/roles/."""
    roles = []
    if not roles_dir.exists():
        return roles
    for f in roles_dir.glob("*.tmdl"):
        text = f.read_text(encoding="utf-8-sig")
        role = {"name": f.stem, "filters": []}
        for m in re.finditer(
            r"tablePermission\s+'?([^'\n]+)'?\s*\n\s*filterExpression\s*=\s*([^\n]+)", text
        ):
            role["filters"].append({
                "table":      m.group(1).strip(),
                "expression": m.group(2).strip()
            })
        roles.append(role)
    return roles


# ===========================================================================
# MAIN
# ===========================================================================

def main():
    parser = argparse.ArgumentParser(description="Parse TMDL and export to model-catalog.json.")
    parser.add_argument("--model", default="VORTEX - DATASET - HR VUE.SemanticModel/definition")
    parser.add_argument("--json",  default="ci-tools/model-catalog.json")
    args = parser.parse_args()

    model_dir = Path(args.model)
    if not model_dir.exists():
        raise FileNotFoundError(f"Model directory not found: {model_dir}")

    print(f"Parsing TMDL from: {model_dir}")

    model_meta    = parse_model(model_dir / "model.tmdl")
    relationships = parse_relationships(model_dir / "relationships.tmdl")
    roles         = parse_roles(model_dir / "roles")

    tables = []
    tables_dir = model_dir / "tables"
    if tables_dir.exists():
        for tmdl_file in sorted(tables_dir.glob("*.tmdl")):
            table = parse_table(tmdl_file)
            if table:
                tables.append(table)
                print(f"  Parsed: {table['name']} "
                      f"({len(table['columns'])} cols, {len(table['measures'])} measures)")

    catalog = {
        "model":         model_meta,
        "tables":        tables,
        "relationships": relationships,
        "roles":         roles,
    }

    json_path = Path(args.json)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")

    all_cols  = [c for t in tables for c in t["columns"]]
    all_meas  = [m for t in tables for m in t["measures"]]
    all_parts = [p for t in tables for p in t.get("partitions", [])]
    bq_parts  = [p for p in all_parts if p["datasource"] == "Google BigQuery"]

    print(f"\n-- Model Summary ----------------------------------------")
    print(f"  Tables        : {len(tables)}")
    print(f"  Columns       : {len(all_cols)}")
    print(f"  Measures      : {len(all_meas)}")
    print(f"  Relationships : {len(relationships)}")
    print(f"  Roles         : {len(roles)}")
    print(f"  BigQuery parts: {len(bq_parts)}")
    print(f"  Auto DateTime : {'[!] YES' if model_meta.get('autoDateTime') else '[OK] NO'}")
    print(f"  Float columns : {len([c for c in all_cols if c.get('isFloat')])}")
    print(f"  Missing fmt   : {len([c for c in all_cols if c.get('missingFormatString')])}")
    print(f"\nModel catalog saved to: {json_path}")


if __name__ == "__main__":
    main()