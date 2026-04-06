"""
Lineage Engine
Builds a full lineage graph (nodes + edges) for a Power BI project.

Node types: dataSource, table, column, measure, visual
Edge types: connects_to_source, belongs_to_table, defined_in_table,
            references_column, depends_on_measure, references_table,
            uses_field, has_relationship
"""

from __future__ import annotations

import re
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from app.models.catalog import (
    ModelColumn,
    ModelMeasure,
    ModelRelationship,
    ModelTable,
)
from app.services.dax_parser import extract_all_references
from app.utils.mongo_client import get_raw_result


# ---------------------------------------------------------------------------
# Known M-query connector patterns
# ---------------------------------------------------------------------------
_M_CONNECTORS = {
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


def _node(node_id: str, node_type: str, name: str,
          detail: str = "", metadata: Optional[Dict] = None) -> Dict[str, Any]:
    return {
        "id": node_id,
        "type": node_type,
        "name": name,
        "detail": detail,
        "metadata": metadata or {},
    }


def _edge(from_id: str, to_id: str, edge_type: str,
          style: str = "solid", label: str = "") -> Dict[str, Any]:
    payload = {
        "from": from_id,
        "to": to_id,
        "type": edge_type,
        "style": style,
    }
    if label:
        payload["label"] = label
    return payload


class LineageEngine:
    """Build and query the lineage graph for a given project."""

    def __init__(self, project_id: int, db_session):
        self.project_id = project_id
        self.db = db_session

        # PostgreSQL data
        self.tables: List[ModelTable] = (
            ModelTable.query.filter_by(project_id=project_id).all()
        )
        self.columns: List[ModelColumn] = (
            ModelColumn.query.filter_by(project_id=project_id).all()
        )
        self.measures: List[ModelMeasure] = (
            ModelMeasure.query.filter_by(project_id=project_id).all()
        )
        self.relationships: List[ModelRelationship] = (
            ModelRelationship.query.filter_by(project_id=project_id).all()
        )

        # MongoDB data
        self.raw_catalog: Dict = get_raw_result(project_id, "model_catalog") or {}
        self.page_layouts: Dict = get_raw_result(project_id, "page_layouts") or {}

        # Lookup helpers
        self._table_by_name: Dict[str, ModelTable] = {t.name: t for t in self.tables}
        self._measure_by_name: Dict[str, List[ModelMeasure]] = defaultdict(list)
        self._measure_id_by_key: Dict[str, str] = {}
        for m in self.measures:
            self._measure_by_name[m.name].append(m)
            table_name = m.table.name if m.table else "Unknown"
            self._measure_id_by_key[f"{table_name}|{m.name}"] = f"measure:{table_name}.{m.name}"

        # Graph containers
        self.nodes: Dict[str, Dict] = {}
        self.edges: List[Dict] = []

    # ------------------------------------------------------------------
    # Build
    # ------------------------------------------------------------------

    def build_graph(self) -> None:
        """Populate self.nodes and self.edges."""
        # Rebuild from a clean state to avoid duplicate nodes/edges on repeated calls.
        self.nodes = {}
        self.edges = []

        self._build_data_sources()
        self._build_tables()
        self._build_columns()
        self._build_measures()
        self._build_relationships()
        self._build_visuals()

    # -- data sources --------------------------------------------------

    def _build_data_sources(self) -> None:
        """Create dataSource nodes from raw catalog partitions & dataSources list."""
        # From the dataSources list stored by the parser
        for src in self.raw_catalog.get("dataSources", []):
            src_name = self._extract_source_name(src)
            if not src_name:
                continue
            nid = f"source:{src_name}"
            self.nodes[nid] = _node(nid, "dataSource", src_name)

        # Walk each table's partitions to link table -> source
        for raw_table in self.raw_catalog.get("tables", []):
            table_name = raw_table.get("name", "")
            table_nid = f"table:{table_name}"
            for part in raw_table.get("partitions", []):
                expr = self._normalize_expression(part.get("expression", ""))
                if not expr:
                    continue
                for connector_key, display_name in _M_CONNECTORS.items():
                    if connector_key in expr:
                        src_nid = f"source:{display_name}"
                        if src_nid not in self.nodes:
                            self.nodes[src_nid] = _node(src_nid, "dataSource", display_name)
                        self.edges.append(_edge(
                            table_nid,
                            src_nid,
                            "connects_to_source",
                            label=connector_key,
                        ))

    # -- tables --------------------------------------------------------

    def _build_tables(self) -> None:
        col_counts = defaultdict(int)
        meas_counts = defaultdict(int)
        for c in self.columns:
            col_counts[c.table_id] += 1
        for m in self.measures:
            meas_counts[m.table_id] += 1

        for t in self.tables:
            nid = f"table:{t.name}"
            detail = f"{col_counts[t.id]}c / {meas_counts[t.id]}m"
            self.nodes[nid] = _node(nid, "table", t.name, detail=detail, metadata={
                "mode": t.mode,
                "isHidden": t.is_hidden,
            })

    # -- columns -------------------------------------------------------

    def _build_columns(self) -> None:
        for c in self.columns:
            table_name = c.table.name if c.table else "Unknown"
            nid = f"column:{table_name}.{c.name}"
            detail_parts = [table_name]
            if c.data_type:
                detail_parts.append(c.data_type)
            self.nodes[nid] = _node(nid, "column", c.name, detail=" • ".join(detail_parts), metadata={
                "table": table_name,
                "isHidden": c.is_hidden,
                "sourceColumn": c.source_column,
            })
            self.edges.append(
                _edge(nid, f"table:{table_name}", "belongs_to_table", label=table_name)
            )

    # -- measures ------------------------------------------------------

    def _build_measures(self) -> None:
        for m in self.measures:
            table_name = m.table.name if m.table else "Unknown"
            nid = f"measure:{table_name}.{m.name}"
            self.nodes[nid] = _node(nid, "measure", m.name, detail=table_name, metadata={
                "table": table_name,
                "expression": m.expression or "",
                "isHidden": m.is_hidden,
            })
            # Edge: measure -> table (defined_in)
            self.edges.append(
                _edge(nid, f"table:{table_name}", "defined_in_table", style="dashed", label=table_name)
            )

            # Parse DAX references
            refs = extract_all_references(m.expression or "")

            # Measure -> referenced measures
            for ref_name in refs["measures"]:
                ref_measure_id = self._resolve_measure_id(ref_name, preferred_table=table_name)
                if ref_measure_id and ref_measure_id != nid:
                    self.edges.append(
                        _edge(nid, ref_measure_id, "depends_on_measure", label=ref_name)
                    )

            # Measure -> referenced columns
            for col_ref in refs["columns"]:
                col_table = col_ref["table"]
                col_name = col_ref["column"]
                col_nid = f"column:{col_table}.{col_name}"
                if col_nid in self.nodes or col_table in self._table_by_name:
                    self.edges.append(
                        _edge(nid, col_nid, "references_column", label=f"{col_table}.{col_name}")
                    )

            # Measure -> referenced tables
            for tbl_name in refs["tables"]:
                if tbl_name in self._table_by_name:
                    self.edges.append(
                        _edge(nid, f"table:{tbl_name}", "references_table", style="dashed", label=tbl_name)
                    )

    # -- relationships -------------------------------------------------

    def _build_relationships(self) -> None:
        for r in self.relationships:
            from_col = f"column:{r.from_table}.{r.from_column}"
            to_col = f"column:{r.to_table}.{r.to_column}"
            style = "solid" if r.is_active else "dashed"
            self.edges.append(
                _edge(from_col, to_col, "has_relationship", style=style, label=f"{r.from_column} -> {r.to_column}")
            )

    # -- visuals -------------------------------------------------------

    def _build_visuals(self) -> None:
        for page in self.page_layouts.get("pages", []):
            page_name = page.get("displayName") or page.get("name", "")
            for vis in page.get("visuals", []):
                vis_name = vis.get("name", vis.get("id", ""))
                vis_title = vis.get("title", vis.get("type", "Visual"))
                nid = f"visual:{page_name}.{vis_name}"
                self.nodes[nid] = _node(nid, "visual", vis_title, detail=f"{page_name} / {vis.get('type', '')}", metadata={
                    "page": page_name,
                    "visualId": vis.get("id", ""),
                    "visualType": vis.get("type", ""),
                    "fields": vis.get("fields", []),
                })

                # Link visual to fields (measures or columns)
                for field_ref in vis.get("fields", []):
                    target_nid = self._resolve_field_ref(field_ref)
                    if target_nid:
                        self.edges.append(
                            _edge(nid, target_nid, "uses_field", label=field_ref)
                        )

    def _extract_source_name(self, source_obj: Any) -> str:
        """Normalize a source descriptor from raw catalog into a readable source name."""
        if isinstance(source_obj, str):
            return source_obj.strip()
        if isinstance(source_obj, dict):
            for key in ("name", "displayName", "type", "kind", "sourceType"):
                value = source_obj.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        return ""

    def _normalize_expression(self, expr: Any) -> str:
        """Normalize partition expression payload into plain text."""
        if isinstance(expr, str):
            return expr
        if isinstance(expr, list):
            return "\n".join(str(item) for item in expr)
        if isinstance(expr, dict):
            return str(expr)
        return ""

    def _resolve_field_ref(self, query_ref: str) -> Optional[str]:
        """Resolve a Power BI queryRef string to a node id.

        queryRef formats:
          - "Sum(Table.Column)"  -> column:Table.Column
          - "Table.Column"       -> column:Table.Column
          - "Table.Measure"      -> measure:Measure  (if it exists)
          - "CountRows"          -> None (aggregation-only)
        """
        if not query_ref:
            return None

        # Strip aggregation wrappers like Sum(...), Min(...), etc.
        inner = re.sub(r"^\w+\((.+)\)$", r"\1", query_ref)
        inner = inner.strip()

        # Pattern: 'Table Name'[Field] or Table[Field]
        bracket_match = re.match(r"(?:'([^']+)'|([^\[]+))\[([^\]]+)\]", inner)
        if bracket_match:
            table_part = (bracket_match.group(1) or bracket_match.group(2) or "").strip()
            field_part = (bracket_match.group(3) or "").strip()
            measure_id = self._resolve_measure_id(field_part, preferred_table=table_part)
            if measure_id:
                return measure_id
            col_nid = f"column:{table_part}.{field_part}"
            if col_nid in self.nodes or table_part in self._table_by_name:
                return col_nid

        # Split on first dot
        parts = inner.split(".", 1)
        if len(parts) == 2:
            table_part = parts[0].strip().strip("'\"")
            field_part = parts[1].strip().strip("'\"")
            # Check if it's a measure
            measure_id = self._resolve_measure_id(field_part, preferred_table=table_part)
            if measure_id:
                return measure_id
            # Otherwise treat as column
            col_nid = f"column:{table_part}.{field_part}"
            if col_nid in self.nodes:
                return col_nid
            # If the column node wasn't found, still return the id for the edge
            if table_part in self._table_by_name:
                return col_nid
        else:
            # No dot -- could be a measure name
            measure_id = self._resolve_measure_id(inner)
            if measure_id:
                return measure_id

        return None

    def _resolve_measure_id(self, measure_name: str, preferred_table: Optional[str] = None) -> Optional[str]:
        """Resolve a measure name to a measure node id, preferring a table when provided."""
        matches = self._measure_by_name.get(measure_name, [])
        if not matches:
            return None

        if preferred_table:
            preferred_key = f"{preferred_table}|{measure_name}"
            if preferred_key in self._measure_id_by_key:
                return self._measure_id_by_key[preferred_key]

        first = matches[0]
        table_name = first.table.name if first.table else "Unknown"
        return self._measure_id_by_key.get(f"{table_name}|{measure_name}")

    # ------------------------------------------------------------------
    # Query methods
    # ------------------------------------------------------------------

    def get_full_lineage(self) -> Dict[str, Any]:
        """Return all nodes and edges."""
        if not self.nodes:
            self.build_graph()

        valid_nodes = list(self.nodes.values())
        valid_ids = {node["id"] for node in valid_nodes}

        # Keep only edges whose endpoints exist, and remove exact duplicates.
        seen = set()
        valid_edges: List[Dict[str, Any]] = []
        for edge in self.edges:
            edge_from = edge.get("from")
            edge_to = edge.get("to")
            if edge_from not in valid_ids or edge_to not in valid_ids:
                continue
            key = (
                edge_from,
                edge_to,
                edge.get("type", ""),
                edge.get("style", "solid"),
            )
            if key in seen:
                continue
            seen.add(key)
            valid_edges.append(edge)

        return {
            "nodes": valid_nodes,
            "edges": valid_edges,
        }

    def get_visual_trace(self, page_name: str, visual_name: str) -> Dict[str, Any]:
        """Trace from a specific visual back to all upstream sources."""
        if not self.nodes:
            self.build_graph()

        # Find the visual node
        target_nid = None
        for nid, node in self.nodes.items():
            if node["type"] != "visual":
                continue
            meta = node.get("metadata", {})
            if meta.get("page", "") == page_name and (
                meta.get("visualId", "") == visual_name
                or nid.endswith(f".{visual_name}")
                or node["name"] == visual_name
            ):
                target_nid = nid
                break

        if not target_nid:
            return {"nodes": [], "edges": [], "error": "Visual not found"}

        # BFS upstream (follow edges where edge["from"] == current node)
        visited_nodes: Set[str] = set()
        visited_edges: List[Dict] = []
        queue = [target_nid]
        visited_nodes.add(target_nid)

        # Build adjacency: from -> [(to, edge)]
        from_adj: Dict[str, List] = defaultdict(list)
        for e in self.edges:
            from_adj[e["from"]].append(e)

        while queue:
            current = queue.pop(0)
            for edge in from_adj.get(current, []):
                visited_edges.append(edge)
                if edge["to"] not in visited_nodes:
                    visited_nodes.add(edge["to"])
                    queue.append(edge["to"])

        result_nodes = [self.nodes[nid] for nid in visited_nodes if nid in self.nodes]
        return {"nodes": result_nodes, "edges": visited_edges}

    def get_measure_impact(self, measure_name: str) -> Dict[str, Any]:
        """Find focused impact graph for a measure.

        Returns:
            - selected source measure
            - dependent measures (transitive)
            - visuals using source/dependent measures
        Excludes generic upstream context (columns/tables/sources) to keep
        impact analysis concise and comparable to impact-only views.
        """
        if not self.nodes:
            self.build_graph()

        source_nid = self._resolve_measure_id(measure_name)
        if not source_nid:
            return {"nodes": [], "edges": [], "error": "Measure not found"}

        if source_nid not in self.nodes:
            return {"nodes": [], "edges": [], "error": "Measure not found"}

        relevant_nodes: Set[str] = {source_nid}
        relevant_edges: List[Dict[str, Any]] = []

        # Reverse adjacency only on measure dependency edges:
        # measure A -> measure B means A depends on B.
        dep_reverse: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for edge in self.edges:
            if edge.get("type") == "depends_on_measure":
                dep_reverse[edge.get("to", "")].append(edge)

        # Collect transitive dependent measures of source
        dependent_measure_ids: Set[str] = set()
        queue = [source_nid]
        while queue:
            current = queue.pop(0)
            for edge in dep_reverse.get(current, []):
                from_id = edge.get("from", "")
                if not from_id.startswith("measure:"):
                    continue
                relevant_edges.append(edge)
                if from_id not in dependent_measure_ids and from_id != source_nid:
                    dependent_measure_ids.add(from_id)
                    relevant_nodes.add(from_id)
                    queue.append(from_id)

        # Include visuals that use source measure or any dependent measure
        impacted_measures = {source_nid, *dependent_measure_ids}
        for edge in self.edges:
            if edge.get("type") != "uses_field":
                continue
            to_id = edge.get("to", "")
            from_id = edge.get("from", "")
            if to_id in impacted_measures and from_id.startswith("visual:") and from_id in self.nodes:
                relevant_nodes.add(from_id)
                relevant_edges.append(edge)

        # De-duplicate edges
        deduped_edges: List[Dict[str, Any]] = []
        seen = set()
        for edge in relevant_edges:
            key = (
                edge.get("from"),
                edge.get("to"),
                edge.get("type"),
                edge.get("style", "solid"),
                edge.get("label", ""),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped_edges.append(edge)

        result_nodes = [self.nodes[nid] for nid in relevant_nodes if nid in self.nodes]
        for node in result_nodes:
            node_meta = node.setdefault("metadata", {})
            nid = node.get("id", "")
            if nid == source_nid:
                node_meta["impactRole"] = "source"
            elif nid in dependent_measure_ids:
                node_meta["impactRole"] = "dependent"
            elif nid.startswith("visual:"):
                node_meta["impactRole"] = "visual"
        return {"nodes": result_nodes, "edges": deduped_edges}

    def get_column_impact(self, table_name: str, column_name: str) -> Dict[str, Any]:
        """Find all measures and visuals affected by this column."""
        if not self.nodes:
            self.build_graph()

        source_nid = f"column:{table_name}.{column_name}"
        if source_nid not in self.nodes:
            return {"nodes": [], "edges": [], "error": "Column not found"}

        relevant_nodes: Set[str] = {source_nid}
        relevant_edges: List[Dict[str, Any]] = []

        # 1) Measures directly referencing this column
        direct_measure_ids: Set[str] = set()
        for edge in self.edges:
            if edge.get("type") == "references_column" and edge.get("to") == source_nid:
                from_id = edge.get("from", "")
                if from_id.startswith("measure:") and from_id in self.nodes:
                    direct_measure_ids.add(from_id)
                    relevant_nodes.add(from_id)
                    relevant_edges.append(edge)

        # 2) Visuals directly using this column
        direct_visual_ids: Set[str] = set()
        for edge in self.edges:
            if edge.get("type") == "uses_field" and edge.get("to") == source_nid:
                from_id = edge.get("from", "")
                if from_id.startswith("visual:") and from_id in self.nodes:
                    direct_visual_ids.add(from_id)
                    relevant_nodes.add(from_id)
                    relevant_edges.append(edge)

        # 3) Visuals using the directly referenced measures
        for edge in self.edges:
            if edge.get("type") == "uses_field" and edge.get("to") in direct_measure_ids:
                from_id = edge.get("from", "")
                if from_id.startswith("visual:") and from_id in self.nodes:
                    relevant_nodes.add(from_id)
                    relevant_edges.append(edge)

        # 4) Minimal upstream context (column -> table -> source)
        for edge in self.edges:
            if edge.get("type") == "belongs_to_table" and edge.get("from") == source_nid:
                table_id = edge.get("to", "")
                if table_id in self.nodes:
                    relevant_nodes.add(table_id)
                    relevant_edges.append(edge)
                    for e2 in self.edges:
                        if e2.get("type") == "connects_to_source" and e2.get("from") == table_id:
                            source_id = e2.get("to", "")
                            if source_id in self.nodes:
                                relevant_nodes.add(source_id)
                                relevant_edges.append(e2)

        # De-duplicate exact edges
        deduped_edges: List[Dict[str, Any]] = []
        seen = set()
        for edge in relevant_edges:
            key = (
                edge.get("from"),
                edge.get("to"),
                edge.get("type"),
                edge.get("style", "solid"),
                edge.get("label", ""),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped_edges.append(edge)

        result_nodes = [self.nodes[nid] for nid in relevant_nodes if nid in self.nodes]
        return {"nodes": result_nodes, "edges": deduped_edges}

    # ------------------------------------------------------------------
    # List helpers (for dropdowns)
    # ------------------------------------------------------------------

    def list_visuals(self) -> List[Dict[str, str]]:
        """Return a flat list of all visuals with page and name info."""
        if not self.nodes:
            self.build_graph()

        visuals = []
        for nid, node in self.nodes.items():
            if node["type"] == "visual":
                meta = node.get("metadata", {})
                visuals.append({
                    "page": meta.get("page", ""),
                    "visualId": meta.get("visualId", ""),
                    "name": node["name"],
                    "type": meta.get("visualType", ""),
                })
        return visuals

    def list_tables(self) -> List[str]:
        """Return a flat list of all table names."""
        return sorted([t.name for t in self.tables])

    def list_measures(self) -> List[Dict[str, str]]:
        """Return a flat list of all measures."""
        result = []
        for m in self.measures:
            table_name = m.table.name if m.table else ""
            result.append({
                "name": m.name,
                "table": table_name,
                "displayFolder": m.display_folder or "",
            })
        return result

    def list_columns(self, table_name: Optional[str] = None) -> List[Dict[str, str]]:
        """Return columns, optionally filtered by table name."""
        result = []
        for c in self.columns:
            tname = c.table.name if c.table else ""
            if table_name and tname != table_name:
                continue
            result.append({
                "name": c.name,
                "table": tname,
                "dataType": c.data_type or "",
            })
        return result

    def get_partitions(self) -> List[Dict[str, Any]]:
        """Return partition imports enriched with M-query parsing metadata."""
        ci_tools_index = self._load_ci_tools_partition_index()
        partitions: List[Dict[str, Any]] = []
        for raw_table in self.raw_catalog.get("tables", []):
            table_name = raw_table.get("name", "")
            for part in raw_table.get("partitions", []):
                # Support both schemas:
                # - backend parser: sourceType, expression
                # - ci-tools parse-tmdl.py: datasource, queryType, mQuery, bqProject, bqDataset, ...
                expression = self._normalize_expression(
                    part.get("expression")
                    or part.get("mQuery")
                    or part.get("source")
                    or ""
                )

                if not expression and ci_tools_index:
                    key = (table_name, part.get("partitionName") or part.get("name") or "")
                    fallback = ci_tools_index.get(key)
                    if fallback:
                        expression = self._normalize_expression(fallback.get("mQuery") or fallback.get("expression") or "")
                        part = {**fallback, **part}

                source = self._detect_partition_source(
                    part.get("sourceType", "") or part.get("queryType", ""),
                    expression,
                    part.get("datasource", ""),
                )

                bq_project, bq_dataset, bq_table = self._extract_bigquery_parts(expression)
                bq_project = part.get("bqProject") or bq_project
                bq_dataset = part.get("bqDataset") or bq_dataset
                bq_table = part.get("bqTable") or bq_table

                sql_query = part.get("sqlQuery") or self._extract_sql_query(expression)
                sql_server, sql_database, sql_object = self._extract_sql_server_parts(expression, sql_query)
                transformations, step_count = self._extract_m_transformations(expression)
                if part.get("transformations"):
                    if isinstance(part.get("transformations"), list):
                        transformations = ", ".join(str(t) for t in part.get("transformations") if str(t).strip())
                    else:
                        transformations = str(part.get("transformations"))
                if isinstance(part.get("stepCount"), int):
                    step_count = part.get("stepCount")

                source_project = bq_project or sql_server
                source_dataset = bq_dataset or sql_database
                source_object = bq_table or sql_object

                partitions.append({
                    "table": table_name,
                    "partitionName": part.get("partitionName") or part.get("name") or "",
                    "sourceType": part.get("sourceType") or part.get("queryType") or "",
                    "mode": part.get("mode", "import"),
                    "expression": expression,
                    "source": source,
                    "bqProject": bq_project or "—",
                    "bqDataset": bq_dataset or "—",
                    "bqTable": bq_table or "—",
                    "sourceProject": source_project or "—",
                    "sourceDataset": source_dataset or "—",
                    "sourceObject": source_object or "—",
                    "sqlQuery": sql_query or "—",
                    "mTransformations": transformations or "—",
                    "mStepCount": step_count,
                    "fullMQuery": expression or "—",
                })
        return partitions

    def _load_ci_tools_partition_index(self) -> Dict[tuple[str, str], Dict[str, Any]]:
        """Load partition metadata from ci-tools/model-catalog.json when available."""
        try:
            project_root = Path(__file__).resolve().parents[3]
            ci_catalog_path = project_root / "ci-tools" / "model-catalog.json"
            if not ci_catalog_path.exists():
                return {}

            payload = json.loads(ci_catalog_path.read_text(encoding="utf-8-sig"))
            result: Dict[tuple[str, str], Dict[str, Any]] = {}
            for table in payload.get("tables", []):
                table_name = table.get("name", "")
                for part in table.get("partitions", []):
                    part_name = part.get("partitionName") or part.get("name") or ""
                    result[(table_name, part_name)] = part
            return result
        except Exception:
            return {}

    def _detect_partition_source(self, source_type: str, expression: str, explicit_datasource: str = "") -> str:
        explicit = (explicit_datasource or "").strip()
        if explicit and explicit.lower() not in {"unknown", "none", "m"}:
            return explicit

        normalized_source = (source_type or "").strip()
        # Generic source type values should not short-circuit detection.
        if normalized_source and normalized_source.lower() not in {"unknown", "none", "m", "import", "calculated"}:
            return normalized_source

        if normalized_source.lower() == "calculated":
            return "Calculated Table (DAX)"

        for connector_key, display_name in _M_CONNECTORS.items():
            if connector_key in expression:
                return display_name

        if "Value.NativeQuery" in expression:
            return "Native Query"

        return "Unknown"

    def _extract_bigquery_parts(self, expression: str) -> tuple[str, str, str]:
        expr = expression.replace('""', '"')

        # Pattern: BillingProject=BQ_Proj or BillingProject="my-project"
        project = ""
        match_project_var = re.search(r"BillingProject\s*=\s*([A-Za-z_][\w-]*)", expr)
        if match_project_var:
            project = match_project_var.group(1)
        else:
            match_project_literal = re.search(r"BillingProject\s*=\s*\"([^\"]+)\"", expr)
            if match_project_literal:
                project = match_project_literal.group(1)

        dataset = ""
        table = ""

        # Pattern from dynamic SQL string: .dataset.table`
        match_ds_tbl = re.search(r"\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)`", expr)
        if match_ds_tbl:
            dataset = match_ds_tbl.group(1)
            table = match_ds_tbl.group(2)

        # Pattern from literal backtick: `project.dataset.table`
        if not dataset or not table:
            match_literal = re.search(r"`([^`]+)`", expr)
            if match_literal:
                parts = [p for p in match_literal.group(1).split('.') if p]
                if len(parts) >= 3:
                    project = project or self._sanitize_bigquery_token(parts[0])
                    dataset = dataset or parts[1]
                    table = table or parts[2]

        return (
            self._sanitize_bigquery_token(project),
            dataset,
            table,
        )

    def _sanitize_bigquery_token(self, token: str) -> str:
        cleaned = (token or "").strip().strip('"').strip("'")
        cleaned = cleaned.replace("&", "").replace("`", "")
        return cleaned

    def _extract_sql_query(self, expression: str) -> str:
        expr = expression.replace('#(lf)', '\n').replace('""', '"')
        match = re.search(r"(SELECT[\s\S]*?FROM[\s\S]*?`[^`]+`)", expr, re.IGNORECASE)
        if not match:
            match = re.search(r"(SELECT[\s\S]*?FROM[\s\S]*?(?:\[[^\]]+\]\.?\[[^\]]+\]|[A-Za-z_][\w]*\.[A-Za-z_][\w]*))", expr, re.IGNORECASE)
            if not match:
                return ""
        return "\n".join(line.rstrip() for line in match.group(1).splitlines()).strip()

    def _extract_sql_server_parts(self, expression: str, sql_query: str) -> tuple[str, str, str]:
        expr = expression.replace('""', '"')
        server = ""
        database = ""
        source_object = ""

        m = re.search(r"Sql\.Database\(\s*\"([^\"]+)\"\s*,\s*\"([^\"]+)\"", expr)
        if m:
            server = m.group(1)
            database = m.group(2)

        sql = sql_query or ""
        m_bracket = re.search(r"FROM\s+\[([^\]]+)\]\.\[([^\]]+)\]", sql, re.IGNORECASE)
        if m_bracket:
            source_object = f"{m_bracket.group(1)}.{m_bracket.group(2)}"
        else:
            m_dot = re.search(r"FROM\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)", sql, re.IGNORECASE)
            if m_dot:
                source_object = f"{m_dot.group(1)}.{m_dot.group(2)}"

        return server, database, source_object

    def _extract_m_transformations(self, expression: str) -> tuple[str, int]:
        # Count transformation steps based on Table.<Function> assignments.
        functions = re.findall(r"=\s*Table\.([A-Za-z0-9_]+)\(", expression)
        if not functions:
            return "", 0

        labels: List[str] = []
        mapping = {
            "AddColumn": "Ajout colonne",
            "NestedJoin": "Join",
            "ExpandTableColumn": "Expand colonnes",
            "ReorderColumns": "Reorder colonnes",
            "TransformColumnTypes": "Type cast",
            "RenameColumns": "Rename colonnes",
            "SelectRows": "Filter lignes",
            "RemoveColumns": "Suppression colonnes",
            "Group": "Group",
            "Combine": "Combine",
        }

        for fn in functions:
            label = mapping.get(fn, fn)
            if label not in labels:
                labels.append(label)

        return ", ".join(labels), len(functions)
