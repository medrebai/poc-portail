"""Match BPA rule IDs with fix templates and render placeholders."""

import json
from functools import lru_cache
from flask import current_app


@lru_cache(maxsize=1)
def _load_fix_templates() -> dict:
    templates_path = current_app.config['BPA_FIX_TEMPLATES_PATH']
    with open(templates_path, 'r', encoding='utf-8') as f:
        templates = json.load(f)
    return {item['ruleId']: item for item in templates}


def build_fix_suggestion(rule_id: str, table_name: str, object_name: str, fallback_object: str = '') -> dict:
    templates = _load_fix_templates()
    tpl = templates.get(rule_id)
    if not tpl:
        return {'action': 'Manual review required', 'steps': ['Review the violation in Tabular Editor']}

    tbl = (table_name or '').strip()
    obj = (object_name or '').strip()
    if not tbl:
        tbl = (fallback_object or '').strip()

    action = tpl.get('template', '').replace('{table}', tbl).replace('{object}', obj)
    steps = [str(step).replace('{table}', tbl).replace('{object}', obj) for step in tpl.get('steps', [])]

    suggestion = {'action': action, 'steps': steps}
    if tpl.get('warning'):
        suggestion['warning'] = tpl['warning']
    return suggestion


def reset_fix_template_cache() -> None:
    _load_fix_templates.cache_clear()
