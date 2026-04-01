from flask import Blueprint, request, jsonify
from app import db
from app.models import Project, ModelTable, ModelColumn, ModelMeasure, ModelRelationship, ModelRole

catalog_bp = Blueprint('catalog', __name__)


@catalog_bp.route('/<int:project_id>/catalog', methods=['GET'])
def get_catalog(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    table_filter = request.args.get('table')

    query = ModelTable.query.filter_by(project_id=project_id)
    if table_filter:
        query = query.filter(ModelTable.name.ilike(f'%{table_filter}%'))
    tables = query.all()

    result_tables = []
    for t in tables:
        td = t.to_dict()
        td['columns'] = [c.to_dict() for c in t.columns]
        td['measures'] = [m.to_dict() for m in t.measures]
        result_tables.append(td)

    relationships = ModelRelationship.query.filter_by(project_id=project_id).all()
    roles = ModelRole.query.filter_by(project_id=project_id).all()

    return jsonify({
        'project': project.to_dict(),
        'summary': {
            'table_count': project.table_count or 0,
            'measure_count': project.measure_count or 0,
            'column_count': project.column_count or 0,
            'relationship_count': project.relationship_count or 0,
        },
        'tables': result_tables,
        'relationships': [r.to_dict() for r in relationships],
        'roles': [r.to_dict() for r in roles],
    })


@catalog_bp.route('/<int:project_id>/catalog/tables', methods=['GET'])
def get_tables(project_id):
    tables = ModelTable.query.filter_by(project_id=project_id).all()
    return jsonify([t.to_dict() for t in tables])


@catalog_bp.route('/<int:project_id>/catalog/measures', methods=['GET'])
def get_measures(project_id):
    query = ModelMeasure.query.filter_by(project_id=project_id)

    table_filter = request.args.get('table')
    if table_filter:
        query = query.join(ModelTable).filter(ModelTable.name.ilike(f'%{table_filter}%'))

    folder_filter = request.args.get('folder')
    if folder_filter:
        query = query.filter(ModelMeasure.display_folder.ilike(f'%{folder_filter}%'))

    search = request.args.get('search')
    if search:
        query = query.filter(ModelMeasure.name.ilike(f'%{search}%'))

    measures = query.all()
    result = []
    for m in measures:
        d = m.to_dict()
        d['table_name'] = m.table.name if m.table else ''
        result.append(d)
    return jsonify(result)


@catalog_bp.route('/<int:project_id>/catalog/relationships', methods=['GET'])
def get_relationships(project_id):
    query = ModelRelationship.query.filter_by(project_id=project_id)

    table_filter = request.args.get('table')
    if table_filter:
        query = query.filter(
            db.or_(
                ModelRelationship.from_table.ilike(f'%{table_filter}%'),
                ModelRelationship.to_table.ilike(f'%{table_filter}%'),
            )
        )

    active_filter = request.args.get('active')
    if active_filter is not None:
        query = query.filter(ModelRelationship.is_active == (active_filter.lower() == 'true'))

    rels = query.all()
    return jsonify([r.to_dict() for r in rels])


@catalog_bp.route('/<int:project_id>/catalog/roles', methods=['GET'])
def get_roles(project_id):
    roles = ModelRole.query.filter_by(project_id=project_id).all()
    return jsonify([r.to_dict() for r in roles])
