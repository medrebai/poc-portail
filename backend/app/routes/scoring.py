from flask import Blueprint, jsonify

from app import db
from app.services.scoring_engine import ScoringEngine


scoring_bp = Blueprint("scoring", __name__, url_prefix="/api/projects")


@scoring_bp.route("/<int:project_id>/scores", methods=["GET"])
def get_scores(project_id: int):
    try:
        payload = ScoringEngine.calculate_scores(project_id, db.session)
    except ValueError:
        return jsonify({"error": "Project not found"}), 404

    return jsonify(payload)


@scoring_bp.route("/<int:project_id>/scores/summary", methods=["GET"])
def get_scores_summary(project_id: int):
    try:
        payload = ScoringEngine.calculate_scores(project_id, db.session)
    except ValueError:
        return jsonify({"error": "Project not found"}), 404

    summary = {
        "overall_score": payload["overall_score"],
        "overall_grade": payload["overall_grade"],
        "overall_label": payload["overall_label"],
        "overall_color": payload["overall_color"],
        "model_score": payload["model_score"],
        "visual_score": payload["visual_score"],
    }
    return jsonify(summary)
