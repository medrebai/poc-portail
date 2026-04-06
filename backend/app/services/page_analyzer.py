import os
import json
from typing import List, Dict, Any


class PageAnalyzer:
    """Extract visual layout data from Power BI report pages."""

    @staticmethod
    def analyze_pages(report_dir: str) -> Dict[str, Any]:
        if not os.path.exists(report_dir):
            return {'pages': [], 'bookmarks': []}

        pages = []

        # PBIP structure: <report_dir>/definition/pages/<page_id>/page.json
        pages_dir = os.path.join(report_dir, 'definition', 'pages')
        if os.path.exists(pages_dir):
            for page_id in sorted(os.listdir(pages_dir)):
                page_folder = os.path.join(pages_dir, page_id)
                if not os.path.isdir(page_folder):
                    continue

                page_json_path = os.path.join(page_folder, 'page.json')
                if not os.path.exists(page_json_path):
                    continue

                try:
                    page_data = PageAnalyzer._parse_page(page_json_path, page_folder)
                    if page_data:
                        pages.append(page_data)
                except Exception:
                    pass

        return {'pages': pages}

    @staticmethod
    def _parse_page(page_json_path: str, page_folder: str) -> Dict[str, Any]:
        with open(page_json_path, 'r', encoding='utf-8') as f:
            page_def = json.load(f)

        page_width = page_def.get('width', 1280)
        page_height = page_def.get('height', 720)

        # Visuals are in <page_folder>/visuals/<visual_id>/visual.json
        visuals = PageAnalyzer._extract_visuals(page_folder)

        return {
            'name': page_def.get('name', os.path.basename(page_folder)),
            'displayName': page_def.get('displayName', page_def.get('name', '')),
            'width': page_width,
            'height': page_height,
            'visuals': visuals,
        }

    @staticmethod
    def _extract_visuals(page_folder: str) -> List[Dict[str, Any]]:
        visuals = []
        visuals_dir = os.path.join(page_folder, 'visuals')
        if not os.path.exists(visuals_dir):
            return visuals

        for visual_id in sorted(os.listdir(visuals_dir)):
            visual_folder = os.path.join(visuals_dir, visual_id)
            if not os.path.isdir(visual_folder):
                continue

            visual_json_path = os.path.join(visual_folder, 'visual.json')
            if not os.path.exists(visual_json_path):
                continue

            try:
                with open(visual_json_path, 'r', encoding='utf-8') as f:
                    visual_def = json.load(f)

                visual_info = PageAnalyzer._parse_visual(visual_id, visual_def)
                if visual_info:
                    visuals.append(visual_info)
            except Exception:
                pass

        return visuals

    @staticmethod
    def _parse_visual(visual_id: str, visual_def: Dict[str, Any]) -> Dict[str, Any]:
        try:
            # Visual type is in visual_def['visual']['visualType']
            visual_type = 'unknown'
            visual_obj = visual_def.get('visual', {})
            if isinstance(visual_obj, dict):
                visual_type = visual_obj.get('visualType', 'unknown')

            # Extract title from visual objects or derive from query fields
            title = PageAnalyzer._extract_visual_title(visual_def)

            # Position is at the root level
            pos = visual_def.get('position', {})
            x = pos.get('x', 0)
            y = pos.get('y', 0)
            width = pos.get('width', 200)
            height = pos.get('height', 150)

            # Categorize the visual type for styling
            category = PageAnalyzer.get_visual_type_category(visual_type)

            # Extract query field names for context
            fields = PageAnalyzer._extract_query_fields(visual_obj)

            return {
                'id': visual_id,
                'name': visual_def.get('name', visual_id),
                'title': title,
                'type': visual_type,
                'category': category,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
                'fields': fields,
            }
        except Exception:
            return None

    @staticmethod
    def _extract_visual_title(visual_def: Dict[str, Any]) -> str:
        """Extract a meaningful title from visual definition."""
        visual_obj = visual_def.get('visual', {})

        # Try objects.general[].properties.titleText
        objects = visual_obj.get('objects', {})
        general = objects.get('general', [])
        if general and isinstance(general, list):
            for entry in general:
                props = entry.get('properties', {})
                title_text = props.get('titleText', {})
                if isinstance(title_text, dict):
                    expr = title_text.get('expr', {})
                    literal = expr.get('Literal', {})
                    val = literal.get('Value', '')
                    if val:
                        return val.strip("'\"")

        # Derive from query fields: use nativeQueryRef values
        query = visual_obj.get('query', {})
        query_state = query.get('queryState', {})
        refs = []
        for _role, role_data in query_state.items():
            projections = role_data.get('projections', [])
            for proj in projections:
                native_ref = proj.get('nativeQueryRef', '')
                if native_ref:
                    refs.append(native_ref)
        if refs:
            visual_type = visual_obj.get('visualType', '')
            return f"{visual_type} — {', '.join(refs[:3])}"

        return visual_obj.get('visualType', 'Visual')

    @staticmethod
    def _extract_query_fields(visual_obj: Dict[str, Any]) -> List[str]:
        """Extract field names from visual query for display."""
        fields: List[str] = []
        seen = set()

        def add_field(value: str) -> None:
            cleaned = (value or '').strip()
            if not cleaned or cleaned in seen:
                return
            seen.add(cleaned)
            fields.append(cleaned)

        def extract_from_field_node(field_node: Dict[str, Any]) -> None:
            if not isinstance(field_node, dict):
                return

            column = field_node.get('Column')
            if isinstance(column, dict):
                entity = (column.get('Expression') or {}).get('SourceRef', {}).get('Entity', '')
                prop = column.get('Property', '')
                if entity and prop:
                    add_field(f"{entity}.{prop}")
                return

            measure = field_node.get('Measure')
            if isinstance(measure, dict):
                entity = (measure.get('Expression') or {}).get('SourceRef', {}).get('Entity', '')
                prop = measure.get('Property', '')
                if entity and prop:
                    add_field(f"{entity}.{prop}")
                return

            hierarchy = field_node.get('Hierarchy')
            if isinstance(hierarchy, dict):
                entity = (hierarchy.get('Expression') or {}).get('SourceRef', {}).get('Entity', '')
                name = hierarchy.get('Hierarchy', '')
                if entity and name:
                    add_field(f"{entity}.{name}")

        query = visual_obj.get('query', {})
        query_state = query.get('queryState', {})
        for _role, role_data in query_state.items():
            projections = role_data.get('projections', [])
            for proj in projections:
                extract_from_field_node(proj.get('field', {}))
                query_ref = proj.get('queryRef', '')
                if query_ref:
                    add_field(query_ref)

                native_ref = proj.get('nativeQueryRef', '')
                if native_ref:
                    add_field(native_ref)

            for fp in role_data.get('fieldParameters', []) or []:
                param_expr = fp.get('parameterExpr', {})
                extract_from_field_node(param_expr)

        sort_def = query.get('sortDefinition', {})
        for sort_item in sort_def.get('sort', []) or []:
            extract_from_field_node(sort_item.get('field', {}))

        filter_config = visual_obj.get('filterConfig', {})
        for flt in filter_config.get('filters', []) or []:
            extract_from_field_node(flt.get('field', {}))

        return fields

    @staticmethod
    def get_visual_type_category(visual_type: str) -> str:
        visual_type_lower = visual_type.lower()

        if 'slicer' in visual_type_lower:
            return 'slicer'
        if any(x in visual_type_lower for x in ['column', 'bar', 'chart', 'line', 'area', 'scatter']):
            return 'chart'
        if 'table' in visual_type_lower or 'matrix' in visual_type_lower:
            return 'table'
        if any(x in visual_type_lower for x in ['card', 'kpi', 'gauge']):
            return 'card'
        if 'map' in visual_type_lower:
            return 'map'
        if 'text' in visual_type_lower:
            return 'text'

        return 'other'
