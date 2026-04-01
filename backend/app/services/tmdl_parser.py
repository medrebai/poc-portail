"""
TMDL Parser Service — ported from ci-tools/parse-tmdl.py
Parses TMDL files from a PBIP SemanticModel definition folder.
"""

import re
from pathlib import Path


def _val(text: str, key: str) -> str | None:
    m = re.search(rf"^\s*{key}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else None


def parse_model(model_path: Path) -> dict:
    text = model_path.read_text(encoding="utf-8-sig")
    meta = {
        "culture": _val(text, "culture"),
        "sourceQueryCulture": _val(text, "sourceQueryCulture"),
        "defaultPowerBIDataSourceVersion": _val(text, "defaultPowerBIDataSourceVersion"),
        "autoDateTime": "__PBI_TimeIntelligenceEnabled" in text,
        "tables": [],
    }
    for m in re.finditer(r"^ref table (.+)$", text, re.MULTILINE):
        name = m.group(1).strip().strip("'")
        if not name.startswith("LocalDateTable") and not name.startswith("DateTableTemplate"):
            meta["tables"].append(name)
    return meta


def parse_relationships(rel_path: Path) -> list:
    if not rel_path.exists():
        return []
    text = rel_path.read_text(encoding="utf-8-sig")
    rels = []
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
        to_table, to_col = split_col(tc)

        rels.append({
            "fromTable": from_table,
            "fromColumn": from_col,
            "toTable": to_table,
            "toColumn": to_col,
            "crossFilter": "bothDirections" if "bothDirections" in block else "singleDirection",
            "fromCardinality": _val(block, "fromCardinality") or "many",
            "toCardinality": _val(block, "toCardinality") or "one",
            "isActive": "state: inactive" not in block,
        })
    return rels


def parse_table(tmdl_path: Path) -> dict | None:
    text = tmdl_path.read_text(encoding="utf-8-sig")

    m = re.match(r"table\s+'?([^'\n]+)'?", text)
    table_name = m.group(1).strip() if m else tmdl_path.stem

    if table_name.startswith("LocalDateTable") or table_name.startswith("DateTableTemplate"):
        return None

    mode_m = re.search(r"mode:\s+(\w+)", text)

    result = {
        "name": table_name,
        "isHidden": "isHidden" in text,
        "mode": mode_m.group(1) if mode_m else "import",
        "columns": [],
        "measures": [],
        "partitions": [],
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
    name = m.group(1).strip()
    data_type = _val(block, "dataType") or "string"
    fmt = _val(block, "formatString")
    is_hidden = "isHidden" in block

    return {
        "name": name,
        "dataType": data_type,
        "formatString": fmt,
        "isHidden": is_hidden,
        "displayFolder": _val(block, "displayFolder"),
        "sourceColumn": _val(block, "sourceColumn") or name,
        "description": _val(block, "description"),
    }


def _parse_measure(block: str) -> dict | None:
    m = re.match(r"measure\s+'?([^'\n=]+)'?", block)
    if not m:
        return None
    name = m.group(1).strip()
    fmt = _val(block, "formatString")
    is_hidden = "isHidden" in block

    dax = ""
    dax_m = re.search(r"=\s*\n?([\s\S]+?)(?=\n\t\t\w|\n\t\w|$)", block)
    if dax_m:
        dax = re.sub(r"\n\t+", "\n", dax_m.group(1)).strip()

    return {
        "name": name,
        "expression": dax,
        "formatString": fmt,
        "displayFolder": _val(block, "displayFolder"),
        "isHidden": is_hidden,
        "description": _val(block, "description"),
    }


def _parse_partition(table_name: str, block: str) -> dict:
    name_m = re.match(r"'?([^'\n=]+)'?\s*=\s*(\w+)", block)
    part_name = name_m.group(1).strip() if name_m else table_name
    mode_m = re.search(r"mode:\s+(\w+)", block)
    mode = mode_m.group(1) if mode_m else "import"

    return {
        "partitionName": part_name,
        "mode": mode,
    }


def parse_roles(roles_dir: Path) -> list:
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
                "table": m.group(1).strip(),
                "expression": m.group(2).strip(),
            })
        roles.append(role)
    return roles


def parse_data_sources(tables_dir: Path) -> list:
    """Extract unique data source connectors from table partition M expressions."""
    sources = set()
    known_connectors = {
        "GoogleBigQuery.Database": "Google BigQuery",
        "Sql.Database": "SQL Server",
        "Sql.Databases": "SQL Server",
        "Oracle.Database": "Oracle",
        "Odbc.DataSource": "ODBC",
        "OData.Feed": "OData",
        "Web.Contents": "Web",
        "Excel.Workbook": "Excel",
        "Csv.Document": "CSV",
        "SharePoint.Files": "SharePoint",
        "Folder.Files": "Folder",
        "AzureStorage.Blobs": "Azure Blob Storage",
        "Snowflake.Databases": "Snowflake",
        "PostgreSQL.Database": "PostgreSQL",
        "MySQL.Database": "MySQL",
        "Salesforce.Data": "Salesforce",
        "AmazonRedshift.Database": "Amazon Redshift",
        "Databricks.Catalogs": "Databricks",
    }
    if not tables_dir.exists():
        return []
    for tmdl_file in tables_dir.glob("*.tmdl"):
        text = tmdl_file.read_text(encoding="utf-8-sig")
        for connector_key, display_name in known_connectors.items():
            if connector_key in text:
                sources.add(display_name)
    return sorted(sources)


def parse_full_model(definition_dir: str) -> dict:
    """Parse the full TMDL model and return the catalog dict."""
    model_dir = Path(definition_dir)

    model_meta = parse_model(model_dir / "model.tmdl")
    relationships = parse_relationships(model_dir / "relationships.tmdl")
    roles = parse_roles(model_dir / "roles")

    tables = []
    tables_dir = model_dir / "tables"
    if tables_dir.exists():
        for tmdl_file in sorted(tables_dir.glob("*.tmdl")):
            table = parse_table(tmdl_file)
            if table:
                tables.append(table)

    return {
        "model": model_meta,
        "tables": tables,
        "relationships": relationships,
        "roles": roles,
        "dataSources": parse_data_sources(tables_dir),
    }
