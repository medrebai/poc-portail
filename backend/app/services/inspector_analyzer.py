"""
PBI Inspector Service — runs PBI Inspector CLI and parses JSON output.
Ported from ci-tools/run-pbi-inspector.ps1
"""

import os
import json
import glob
import time
import subprocess
from flask import current_app


def run_inspector(report_path: str) -> dict:
    """Run PBI Inspector CLI and return structured results."""
    inspector_path = current_app.config['PBI_INSPECTOR_PATH']
    rules_path = os.path.abspath(current_app.config['PBI_INSPECTOR_RULES_PATH'])

    if not os.path.exists(inspector_path):
        raise FileNotFoundError(f"PBI Inspector not found: {inspector_path}")
    if not os.path.exists(report_path):
        raise FileNotFoundError(f"Report path not found: {report_path}")

    # Use a temp output directory
    output_dir = os.path.join(os.path.dirname(report_path), '_inspector_output')
    os.makedirs(output_dir, exist_ok=True)

    result = subprocess.run(
        [inspector_path,
         "-fabricitem", report_path,
         "-rules", rules_path,
         "-formats", "JSON",
         "-output", output_dir,
         "-verbose", "true"],
        capture_output=True, text=True, encoding='utf-8', errors='replace',
        timeout=120,
    )

    if result.returncode not in (0, 1):
        raise RuntimeError(f"PBI Inspector crashed (exit {result.returncode}): {result.stderr}")

    # Find the generated TestRun_*.json file (wait up to 15s)
    generated_file = None
    for _ in range(30):
        files = glob.glob(os.path.join(output_dir, "TestRun_*.json"))
        if files:
            generated_file = max(files, key=os.path.getmtime)
            break
        time.sleep(0.5)

    if not generated_file:
        raise RuntimeError("PBI Inspector did not generate a JSON output file")

    with open(generated_file, 'r', encoding='utf-8-sig') as f:
        raw_data = json.load(f)

    # Clean up temp files
    try:
        os.remove(generated_file)
        os.rmdir(output_dir)
    except OSError:
        pass

    return parse_inspector_results(raw_data)


def parse_inspector_results(raw_data: dict) -> dict:
    """Parse PBI Inspector raw JSON into structured results."""
    results = raw_data.get('Results', [])

    parsed = []
    for r in results:
        parsed.append({
            'ruleId': r.get('RuleId', ''),
            'ruleName': r.get('RuleName', ''),
            'ruleDescription': r.get('RuleDescription', ''),
            'pageName': r.get('ParentDisplayName', 'Report level'),
            'passed': r.get('Pass', True),
            'expected': r.get('Expected'),
            'actual': r.get('Actual'),
        })

    passed_count = sum(1 for r in parsed if r['passed'])
    failed_count = sum(1 for r in parsed if not r['passed'])

    return {
        'totalRules': len(parsed),
        'passedCount': passed_count,
        'failedCount': failed_count,
        'results': parsed,
    }
