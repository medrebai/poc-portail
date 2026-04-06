from flask import Blueprint, request, jsonify
import time
from app import db
from app.models import Project
from app.services.lineage_engine import LineageEngine

lineage_bp = Blueprint('lineage', __name__)

_engine_cache = {}
_CACHE_TTL = 120  # seconds


def _get_cached_engine(project_id):
    """Get or create a cached lineage engine for a project."""
    now = time.time()

    if project_id in _engine_cache:
        engine, ts = _engine_cache[project_id]
        if now - ts < _CACHE_TTL:
            return engine, None

    project = db.session.get(Project, project_id)
    if not project:
        return None, (jsonify({'error': 'Project not found'}), 404)

    engine = LineageEngine(project_id, db.session)
    engine.build_graph()
    _engine_cache[project_id] = (engine, now)
    return engine, None


@lineage_bp.route('/<int:project_id>/lineage', methods=['GET'])
def get_full_lineage(project_id):
    """Full lineage graph (all nodes + edges)."""
    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    return jsonify(engine.get_full_lineage())


@lineage_bp.route('/<int:project_id>/lineage/visual-trace', methods=['GET'])
def get_visual_trace(project_id):
    """Trace from a visual back to its data sources."""
    page = request.args.get('page', '')
    visual = request.args.get('visual', '')
    if not page or not visual:
        return jsonify({'error': 'Both "page" and "visual" query params are required'}), 400

    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    result = engine.get_visual_trace(page, visual)
    if result.get('error'):
        return jsonify(result), 404
    return jsonify(result)


@lineage_bp.route('/<int:project_id>/lineage/measure-impact', methods=['GET'])
def get_measure_impact(project_id):
    """Find all visuals and measures affected by a given measure."""
    measure = request.args.get('measure', '')
    if not measure:
        return jsonify({'error': '"measure" query param is required'}), 400

    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    result = engine.get_measure_impact(measure)
    if result.get('error'):
        return jsonify(result), 404
    return jsonify(result)


@lineage_bp.route('/<int:project_id>/lineage/column-impact', methods=['GET'])
def get_column_impact(project_id):
    """Find all measures and visuals affected by a given column."""
    table = request.args.get('table', '')
    column = request.args.get('column', '')
    if not table or not column:
        return jsonify({'error': 'Both "table" and "column" query params are required'}), 400

    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    result = engine.get_column_impact(table, column)
    if result.get('error'):
        return jsonify(result), 404
    return jsonify(result)


@lineage_bp.route('/<int:project_id>/lineage/visuals', methods=['GET'])
def list_visuals(project_id):
    """List all visuals (for dropdown selection)."""
    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    return jsonify(engine.list_visuals())


@lineage_bp.route('/<int:project_id>/lineage/measures', methods=['GET'])
def list_measures(project_id):
    """List all measures (for dropdown selection)."""
    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    return jsonify(engine.list_measures())


@lineage_bp.route('/<int:project_id>/lineage/tables', methods=['GET'])
def list_tables(project_id):
    """List all table names (for dropdown selection)."""
    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    return jsonify(engine.list_tables())


@lineage_bp.route('/<int:project_id>/lineage/columns', methods=['GET'])
def list_columns(project_id):
    """List columns for a table (for dropdown selection)."""
    table = request.args.get('table', None)

    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    return jsonify(engine.list_columns(table))


@lineage_bp.route('/<int:project_id>/catalog/partitions', methods=['GET'])
def get_partitions(project_id):
    """List all partitions with their M queries from MongoDB."""
    engine, err = _get_cached_engine(project_id)
    if err:
        return err

    return jsonify(engine.get_partitions())
