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
    fallback = (fallback_object or '').strip()
    if not tbl:
        tbl = fallback
    if not obj:
        obj = fallback or tbl or 'selected object'

    action = tpl.get('template', '').replace('{table}', tbl).replace('{object}', obj)
    steps = [str(step).replace('{table}', tbl).replace('{object}', obj) for step in tpl.get('steps', [])]
    normalized_steps = []
    for step in steps:
        # Guard against malformed placeholder remnants such as Select ''.
        if "Select ''." in step:
            step = step.replace("Select ''.", f"Select '{obj}'.")
        normalized_steps.append(step)

    suggestion = {'action': action, 'steps': normalized_steps}
    if tpl.get('warning'):
        suggestion['warning'] = tpl['warning']
    return suggestion


def reset_fix_template_cache() -> None:
    _load_fix_templates.cache_clear()
