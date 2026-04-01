from flask import Blueprint, request, jsonify
from app import db
from app.models import Project, InspectorResult

inspector_bp = Blueprint('inspector', __name__)


@inspector_bp.route('/<int:project_id>/inspector', methods=['GET'])
def get_inspector_results(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    query = InspectorResult.query.filter_by(project_id=project_id)

    passed = request.args.get('passed')
    if passed is not None:
        query = query.filter(InspectorResult.passed == (passed.lower() == 'true'))

    page = request.args.get('page')
    if page:
        query = query.filter(InspectorResult.page_name.ilike(f'%{page}%'))

    sort = request.args.get('sort', 'rule_name')
    sort_col = getattr(InspectorResult, sort, InspectorResult.rule_name)
    query = query.order_by(sort_col)

    results = query.all()
    return jsonify([r.to_dict() for r in results])
