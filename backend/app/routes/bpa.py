from flask import Blueprint, request, jsonify
from app import db
from app.models import Project, BpaViolation, BpaSummary

bpa_bp = Blueprint('bpa', __name__)


@bpa_bp.route('/<int:project_id>/bpa', methods=['GET'])
def get_bpa_violations(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    query = BpaViolation.query.filter_by(project_id=project_id)

    # Filters
    severity = request.args.get('severity')
    if severity:
        query = query.filter(BpaViolation.severity == int(severity))

    category = request.args.get('category')
    if category:
        query = query.filter(BpaViolation.category == category)

    rule_id = request.args.get('ruleId')
    if rule_id:
        query = query.filter(BpaViolation.rule_id == rule_id)

    table = request.args.get('table')
    if table:
        query = query.filter(BpaViolation.table_name.ilike(f'%{table}%'))

    object_type = request.args.get('objectType')
    if object_type:
        query = query.filter(BpaViolation.object_type == object_type)

    # Sorting
    sort = request.args.get('sort', 'severity')
    order = request.args.get('order', 'desc')
    sort_col = getattr(BpaViolation, sort, BpaViolation.severity)
    query = query.order_by(sort_col.desc() if order == 'desc' else sort_col.asc())

    violations = query.all()
    return jsonify([v.to_dict() for v in violations])


@bpa_bp.route('/<int:project_id>/bpa/summary', methods=['GET'])
def get_bpa_summary(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    summary = BpaSummary.query.filter_by(project_id=project_id).order_by(BpaSummary.count.desc()).all()
    return jsonify([s.to_dict() for s in summary])
