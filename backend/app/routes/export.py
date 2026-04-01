from flask import Blueprint, send_file, jsonify
from app import db
from app.models import (
    Project, BpaViolation, InspectorResult,
    ModelTable, ModelColumn, ModelMeasure, ModelRelationship, ModelRole,
)
from app.services.export_service import export_bpa, export_inspector, export_catalog

export_bp = Blueprint('export', __name__)


@export_bp.route('/<int:project_id>/export/bpa', methods=['GET'])
def export_bpa_excel(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    violations = BpaViolation.query.filter_by(project_id=project_id).order_by(BpaViolation.severity.desc()).all()
    output = export_bpa(violations)

    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'{project.name}_bpa_report.xlsx',
    )


@export_bp.route('/<int:project_id>/export/inspector', methods=['GET'])
def export_inspector_excel(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    results = InspectorResult.query.filter_by(project_id=project_id).all()
    output = export_inspector(results)

    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'{project.name}_inspector_report.xlsx',
    )


@export_bp.route('/<int:project_id>/export/catalog', methods=['GET'])
def export_catalog_excel(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    tables = ModelTable.query.filter_by(project_id=project_id).all()
    columns = ModelColumn.query.filter_by(project_id=project_id).all()
    measures = ModelMeasure.query.filter_by(project_id=project_id).all()
    relationships = ModelRelationship.query.filter_by(project_id=project_id).all()
    roles = ModelRole.query.filter_by(project_id=project_id).all()

    output = export_catalog(tables, columns, measures, relationships, roles)

    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'{project.name}_catalog_report.xlsx',
    )
