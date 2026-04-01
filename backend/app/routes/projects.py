import os
from flask import Blueprint, request, jsonify, current_app
from app import db
from app.models import (
    Project, BpaViolation, BpaSummary, InspectorResult,
    ModelTable, ModelColumn, ModelMeasure, ModelRelationship, ModelRole,
)
from app.utils.file_handler import extract_zip, validate_pbip_structure, cleanup_upload
from app.utils.file_handler import save_uploaded_folder
from app.utils.mongo_client import store_raw_result, delete_project_results, get_raw_result
from app.services.tmdl_parser import parse_full_model
from app.services.bpa_analyzer import run_bpa
from app.services.inspector_analyzer import run_inspector
from app.services.page_analyzer import PageAnalyzer

projects_bp = Blueprint('projects', __name__)


@projects_bp.route('', methods=['GET'])
def list_projects():
    projects = Project.query.order_by(Project.created_at.desc()).all()
    result = []
    for p in projects:
        d = p.to_dict()
        d['bpa_violation_count'] = BpaViolation.query.filter_by(project_id=p.id).count()
        d['inspector_failed_count'] = InspectorResult.query.filter_by(project_id=p.id, passed=False).count()
        d['data_source_count'] = p.data_source_count or 0
        d['visual_count'] = p.visual_count or 0
        result.append(d)
    return jsonify(result)


@projects_bp.route('', methods=['POST'])
def create_project():
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Project name is required'}), 400

    project = Project(name=data['name'], description=data.get('description', ''))
    db.session.add(project)
    db.session.commit()
    return jsonify(project.to_dict()), 201


@projects_bp.route('/<int:project_id>', methods=['GET'])
def get_project(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    d = project.to_dict()
    d['bpa_violation_count'] = BpaViolation.query.filter_by(project_id=project_id).count()
    d['bpa_error_count'] = BpaViolation.query.filter_by(project_id=project_id, severity=3).count()
    d['bpa_warning_count'] = BpaViolation.query.filter_by(project_id=project_id, severity=2).count()
    d['bpa_info_count'] = BpaViolation.query.filter_by(project_id=project_id, severity=1).count()
    d['inspector_total'] = InspectorResult.query.filter_by(project_id=project_id).count()
    d['inspector_passed_count'] = InspectorResult.query.filter_by(project_id=project_id, passed=True).count()
    d['inspector_failed_count'] = InspectorResult.query.filter_by(project_id=project_id, passed=False).count()
    d['data_source_count'] = project.data_source_count or 0
    d['visual_count'] = project.visual_count or 0
    d['data_sources'] = []
    raw_catalog = get_raw_result(project_id, 'model_catalog')
    if raw_catalog:
        d['data_sources'] = raw_catalog.get('dataSources', [])

    analysis_meta = get_raw_result(project_id, 'analysis_meta')
    d['analysis_meta'] = analysis_meta or {}
    return jsonify(d)


@projects_bp.route('/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    delete_project_results(project_id)
    cleanup_upload(project_id)
    db.session.delete(project)
    db.session.commit()
    return jsonify({'message': 'Project deleted'}), 200


@projects_bp.route('/<int:project_id>/upload', methods=['POST'])
def upload_pbip(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    upload_path = None

    # Mode 1: ZIP upload (existing behavior)
    if 'file' in request.files and request.files['file'].filename:
        file = request.files['file']
        if not file.filename.lower().endswith('.zip'):
            return jsonify({'error': 'File must be a .zip archive'}), 400
        upload_path = extract_zip(file, project_id)

    # Mode 2: Folder upload (files[] + paths[])
    elif 'files' in request.files:
        files = request.files.getlist('files')
        paths = request.form.getlist('paths')

        if not files:
            return jsonify({'error': 'No folder files uploaded'}), 400
        if len(files) != len(paths):
            return jsonify({'error': 'Uploaded files and paths do not match'}), 400

        try:
            upload_path = save_uploaded_folder(files, paths, project_id)
        except ValueError as e:
            cleanup_upload(project_id)
            return jsonify({'error': str(e)}), 400

    if not upload_path:
        return jsonify({'error': 'Provide either a .zip file or a folder upload'}), 400

    validation = validate_pbip_structure(upload_path)

    if not validation['valid']:
        cleanup_upload(project_id)
        return jsonify({'error': 'Invalid PBIP structure', 'details': validation['errors']}), 400

    project.status = 'pending'
    project.error_message = None
    db.session.commit()

    return jsonify({
        'message': 'File uploaded and validated',
        'semantic_model_dir': validation['semantic_model_dir'],
        'report_dir': validation['report_dir'],
    })


@projects_bp.route('/<int:project_id>/analyze', methods=['POST'])
def analyze_project(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    upload_path = os.path.join(os.path.abspath(current_app.config['UPLOAD_FOLDER']), str(project_id))
    if not os.path.exists(upload_path):
        return jsonify({'error': 'No files uploaded. Upload a .pbip ZIP first.'}), 400

    validation = validate_pbip_structure(upload_path)
    if not validation['valid']:
        return jsonify({'error': 'Invalid PBIP structure', 'details': validation['errors']}), 400

    semantic_model_dir = validation['semantic_model_dir']
    report_dir = validation['report_dir']
    definition_dir = os.path.join(semantic_model_dir, 'definition')

    project.status = 'analyzing'
    db.session.commit()

    steps_completed = []
    errors = []

    try:
        analysis_meta = {
            'bpa_rules_path': current_app.config.get('BPA_RULES_PATH'),
            'bpa_fix_templates_path': current_app.config.get('BPA_FIX_TEMPLATES_PATH'),
            'pbi_inspector_rules_path': current_app.config.get('PBI_INSPECTOR_RULES_PATH'),
            'tabular_editor_path': current_app.config.get('TABULAR_EDITOR_PATH'),
            'pbi_inspector_path': current_app.config.get('PBI_INSPECTOR_PATH'),
        }
        store_raw_result(project_id, 'analysis_meta', analysis_meta)

        # Step 1: Parse TMDL
        try:
            catalog = parse_full_model(definition_dir)
            store_raw_result(project_id, 'model_catalog', catalog)
            _store_catalog_in_pg(project_id, catalog)
            steps_completed.append('tmdl_parsing')
        except Exception as e:
            errors.append(f'TMDL parsing failed: {str(e)}')

        # Step 2: BPA Analysis
        try:
            bpa_results = run_bpa(definition_dir)
            store_raw_result(project_id, 'bpa_results', bpa_results)
            _store_bpa_in_pg(project_id, bpa_results)
            steps_completed.append('bpa_analysis')
        except Exception as e:
            errors.append(f'BPA analysis failed: {str(e)}')

        # Step 3: PBI Inspector
        try:
            inspector_results = run_inspector(report_dir)
            store_raw_result(project_id, 'inspector_results', inspector_results)
            _store_inspector_in_pg(project_id, inspector_results, report_dir)
            steps_completed.append('pbi_inspector')
        except Exception as e:
            errors.append(f'PBI Inspector failed: {str(e)}')

        # Step 4: Page Layout extraction
        try:
            page_layouts = PageAnalyzer.analyze_pages(report_dir)
            store_raw_result(project_id, 'page_layouts', page_layouts)
            steps_completed.append('page_layouts')
        except Exception as e:
            errors.append(f'Page layout extraction failed: {str(e)}')

        if errors:
            project.status = 'error'
            project.error_message = '; '.join(errors)
        else:
            project.status = 'ready'
            project.error_message = None

        db.session.commit()

        return jsonify({
            'status': project.status,
            'steps_completed': steps_completed,
            'errors': errors,
            'analysis_meta': analysis_meta,
        })

    except Exception as e:
        project.status = 'error'
        project.error_message = str(e)
        db.session.commit()
        return jsonify({'error': str(e)}), 500
    finally:
        # Uploaded source files are temporary; always remove them after analysis attempt.
        try:
            cleanup_upload(project_id)
        except Exception:
            pass


def _store_catalog_in_pg(project_id, catalog):
    """Store parsed catalog data into PostgreSQL tables."""
    # Clear existing data
    ModelRole.query.filter_by(project_id=project_id).delete()
    ModelRelationship.query.filter_by(project_id=project_id).delete()
    ModelMeasure.query.filter_by(project_id=project_id).delete()
    ModelColumn.query.filter_by(project_id=project_id).delete()
    ModelTable.query.filter_by(project_id=project_id).delete()

    project = db.session.get(Project, project_id)
    total_columns = 0
    total_measures = 0

    for t in catalog.get('tables', []):
        table = ModelTable(
            project_id=project_id,
            name=t['name'],
            is_hidden=t.get('isHidden', False),
            mode=t.get('mode', 'import'),
            column_count=len(t.get('columns', [])),
            measure_count=len(t.get('measures', [])),
            partition_count=len(t.get('partitions', [])),
        )
        db.session.add(table)
        db.session.flush()

        for c in t.get('columns', []):
            col = ModelColumn(
                table_id=table.id,
                project_id=project_id,
                name=c['name'],
                data_type=c.get('dataType', 'string'),
                is_hidden=c.get('isHidden', False),
                format_string=c.get('formatString'),
                description=c.get('description'),
                display_folder=c.get('displayFolder'),
                source_column=c.get('sourceColumn'),
            )
            db.session.add(col)
            total_columns += 1

        for m in t.get('measures', []):
            meas = ModelMeasure(
                table_id=table.id,
                project_id=project_id,
                name=m['name'],
                expression=m.get('expression'),
                format_string=m.get('formatString'),
                description=m.get('description'),
                display_folder=m.get('displayFolder'),
                is_hidden=m.get('isHidden', False),
            )
            db.session.add(meas)
            total_measures += 1

    for r in catalog.get('relationships', []):
        rel = ModelRelationship(
            project_id=project_id,
            from_table=r['fromTable'],
            from_column=r['fromColumn'],
            to_table=r['toTable'],
            to_column=r['toColumn'],
            cross_filter=r.get('crossFilter', 'singleDirection'),
            from_cardinality=r.get('fromCardinality', 'many'),
            to_cardinality=r.get('toCardinality', 'one'),
            is_active=r.get('isActive', True),
        )
        db.session.add(rel)

    for role in catalog.get('roles', []):
        r = ModelRole(
            project_id=project_id,
            name=role['name'],
            filters=role.get('filters', []),
        )
        db.session.add(r)

    # Update project summary
    project.table_count = len(catalog.get('tables', []))
    project.measure_count = total_measures
    project.column_count = total_columns
    project.relationship_count = len(catalog.get('relationships', []))
    project.data_source_count = len(catalog.get('dataSources', []))

    db.session.commit()


def _store_bpa_in_pg(project_id, bpa_results):
    """Store BPA violations and summary in PostgreSQL."""
    BpaViolation.query.filter_by(project_id=project_id).delete()
    BpaSummary.query.filter_by(project_id=project_id).delete()

    for v in bpa_results.get('violations', []):
        violation = BpaViolation(
            project_id=project_id,
            rule_id=v['ruleId'],
            rule_name=v['ruleName'],
            category=v['category'],
            severity=v['severity'],
            severity_label=v['severityLabel'],
            object_type=v.get('objectType'),
            object_name=v.get('objectName', ''),
            table_name=v.get('tableName', ''),
            description=v.get('description', ''),
            fix_template=v.get('suggestedFix', {}).get('action', ''),
            fix_steps=v.get('suggestedFix', {}),
        )
        db.session.add(violation)

    for s in bpa_results.get('summaryByRule', []):
        summary = BpaSummary(
            project_id=project_id,
            rule_id=s['ruleId'],
            rule_name=s['ruleName'],
            category=s['category'],
            severity=s['severity'],
            severity_label=s['severityLabel'],
            count=s['count'],
        )
        db.session.add(summary)

    db.session.commit()


def _store_inspector_in_pg(project_id, inspector_data, report_dir=None):
    """Store Inspector results in PostgreSQL."""
    InspectorResult.query.filter_by(project_id=project_id).delete()

    for r in inspector_data.get('results', []):
        result = InspectorResult(
            project_id=project_id,
            rule_id=r['ruleId'],
            rule_name=r['ruleName'],
            rule_description=r.get('ruleDescription', ''),
            page_name=r.get('pageName', 'Report level'),
            passed=r['passed'],
            expected=r.get('expected'),
            actual=r.get('actual'),
        )
        db.session.add(result)

    # Count actual report pages from filesystem
    project = db.session.get(Project, project_id)
    if project and report_dir and os.path.exists(report_dir):
        try:
            # Pages are stored in <report_dir>/definition/pages/<page_id>/page.json
            pages_dir = os.path.join(report_dir, 'definition', 'pages')
            if os.path.exists(pages_dir):
                page_folders = [d for d in os.listdir(pages_dir) if os.path.isdir(os.path.join(pages_dir, d))]
                project.visual_count = len(page_folders)
            else:
                raise Exception('Pages directory not found')
        except Exception:
            # Fallback: count unique page names from results
            page_names = set()
            for r in inspector_data.get('results', []):
                pn = r.get('pageName', '')
                if pn and pn != 'Report level':
                    page_names.add(pn)
            project.visual_count = len(page_names)
    elif project:
        # Fallback: count unique page names from results
        page_names = set()
        for r in inspector_data.get('results', []):
            pn = r.get('pageName', '')
            if pn and pn != 'Report level':
                page_names.add(pn)
        project.visual_count = len(page_names) + 1  # +1 for report level

    db.session.commit()


@projects_bp.route('/<int:project_id>/health-radar', methods=['GET'])
def get_health_radar(project_id):
    """Return model health scores per category for a radar chart."""
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    # BPA categories and their violation counts
    bpa_cats = db.session.query(
        BpaViolation.category, db.func.count(BpaViolation.id)
    ).filter_by(project_id=project_id).group_by(BpaViolation.category).all()

    cat_counts = {cat: count for cat, count in bpa_cats}

    # Map BPA categories to radar axes
    axes_map = {
        'Naming': ['Naming Conventions'],
        'Performance': ['Performance'],
        'DAX Quality': ['DAX Expressions'],
        'Formatting': ['Formatting', 'Model Layout'],
        'Maintenance': ['Maintenance', 'Metadata'],
        'Error Prevention': ['Error Prevention'],
    }

    axes = []
    for axis_name, categories in axes_map.items():
        total_violations = sum(cat_counts.get(c, 0) for c in categories)
        # Score: 100 minus penalties (each violation = -5, min 0)
        score = max(0, 100 - total_violations * 5)
        axes.append({
            'axis': axis_name,
            'score': score,
            'violations': total_violations,
        })

    return jsonify({'axes': axes})


@projects_bp.route('/<int:project_id>/pages', methods=['GET'])
def get_pages(project_id):
    """Return page layout data with visual metadata for a project."""
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    page_data = get_raw_result(project_id, 'page_layouts')
    if not page_data:
        return jsonify({'pages': []})

    return jsonify(page_data)
