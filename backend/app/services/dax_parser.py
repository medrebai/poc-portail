"""
DAX Reference Extractor
Parses DAX expressions to extract measure, column, and table references.
Uses regex-based parsing similar to pbip-documenter approach.
"""

import re
from typing import Dict, List, Set


def _strip_string_literals(dax: str) -> str:
    """Replace the content of DAX string literals (double-quoted) with empty strings
    so that references inside strings are not accidentally matched."""
    return re.sub(r'"[^"]*"', '""', dax)


def extract_measure_references(dax: str) -> List[str]:
    """Extract standalone measure references like [MeasureName].

    These are square-bracket references NOT preceded by a table name or
    a dot/letter/quote (which would indicate a column reference).
    """
    cleaned = _strip_string_literals(dax)

    # Match [Name] that is NOT preceded by a table qualifier (letter, digit, quote, dot, ])
    # Negative lookbehind: not preceded by word char, quote, dot, or ]
    pattern = r"(?<!['\w\].])\[([^\[\]]+)\]"
    matches = re.findall(pattern, cleaned)

    # Deduplicate while preserving order
    seen: Set[str] = set()
    result: List[str] = []
    for m in matches:
        if m not in seen:
            seen.add(m)
            result.append(m)
    return result


def extract_column_references(dax: str) -> List[Dict[str, str]]:
    """Extract column references like TableName[ColumnName] or 'Table Name'[ColumnName]."""
    cleaned = _strip_string_literals(dax)

    refs: List[Dict[str, str]] = []
    seen: Set[str] = set()

    # Pattern 1: 'Table Name'[Column]
    for m in re.finditer(r"'([^']+)'\[([^\]]+)\]", cleaned):
        key = f"{m.group(1)}|{m.group(2)}"
        if key not in seen:
            seen.add(key)
            refs.append({"table": m.group(1), "column": m.group(2)})

    # Pattern 2: TableName[Column] (unquoted, starts with letter/underscore)
    for m in re.finditer(r"(?<!')([A-Za-z_]\w*)\[([^\]]+)\]", cleaned):
        table = m.group(1)
        col = m.group(2)
        # Skip DAX functions that use brackets (e.g. CALCULATE[...] is not valid but just in case)
        key = f"{table}|{col}"
        if key not in seen:
            seen.add(key)
            refs.append({"table": table, "column": col})

    return refs


# DAX functions that take a table as their first argument
_TABLE_FUNCTIONS = [
    "COUNTROWS", "ALL", "ALLEXCEPT", "ALLNOBLANKROW", "ALLSELECTED",
    "FILTER", "VALUES", "DISTINCT", "SUMMARIZE", "SUMMARIZECOLUMNS",
    "CALCULATETABLE", "RELATEDTABLE", "ADDCOLUMNS", "SELECTCOLUMNS",
    "TOPN", "SAMPLE", "GROUPBY", "NATURALLEFTOUTERJOIN",
    "NATURALINNERJOIN", "CROSSJOIN", "UNION", "INTERSECT", "EXCEPT",
    "DATATABLE", "GENERATESERIES", "GENERATE", "GENERATEALL",
    "TREATAS", "SUBSTITUTEWITHINDEX",
    "CONTAINS", "CONTAINSROW", "ISEMPTY", "HASONEVALUE",
    "ISFILTERED", "ISCROSSFILTERED",
    "USERELATIONSHIP", "CROSSFILTER",
    "LOOKUPVALUE", "RELATED", "RELATEDTABLE",
    "EARLIER", "EARLIEST",
    "RANKX", "MAXX", "MINX", "SUMX", "AVERAGEX", "COUNTX", "COUNTAX",
    "PRODUCTX", "CONCATENATEX", "MEDIANX", "PERCENTILEX.INC",
    "PERCENTILEX.EXC", "STDEVX.S", "STDEVX.P", "VARX.S", "VARX.P",
    "FIRSTNONBLANK", "LASTNONBLANK",
]


def extract_table_references(dax: str) -> List[str]:
    """Extract table names used as arguments to DAX table functions."""
    cleaned = _strip_string_literals(dax)

    tables: Set[str] = set()

    # Build alternation of function names (case insensitive)
    func_pattern = "|".join(re.escape(f) for f in _TABLE_FUNCTIONS)

    # Pattern: FUNCTION ( 'Table Name' ... ) or FUNCTION ( TableName ... )
    # Quoted table: FUNC ( 'My Table'
    for m in re.finditer(
        rf"(?:{func_pattern})\s*\(\s*'([^']+)'",
        cleaned,
        re.IGNORECASE,
    ):
        tables.add(m.group(1))

    # Unquoted table: FUNC ( TableName  (followed by comma, ), [, or whitespace)
    for m in re.finditer(
        rf"(?:{func_pattern})\s*\(\s*([A-Za-z_]\w*)",
        cleaned,
        re.IGNORECASE,
    ):
        candidate = m.group(1)
        # Exclude common DAX keywords and function names
        if candidate.upper() not in {
            "TRUE", "FALSE", "BLANK", "NOT", "AND", "OR", "IF",
            "SWITCH", "VAR", "RETURN", "IN", "ORDER", "BY", "ASC", "DESC",
        }:
            tables.add(candidate)

    return sorted(tables)


def extract_all_references(dax: str) -> Dict[str, list]:
    """Extract all references from a DAX expression.

    Returns a dict with keys: measures, columns, tables.
    """
    if not dax:
        return {"measures": [], "columns": [], "tables": []}

    return {
        "measures": extract_measure_references(dax),
        "columns": extract_column_references(dax),
        "tables": extract_table_references(dax),
    }
