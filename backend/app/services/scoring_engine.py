from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models import BpaViolation, InspectorResult, Project


@dataclass(frozen=True)
class ModelCategoryConfig:
    name: str
    raw_categories: tuple[str, ...]
    weight: float


@dataclass(frozen=True)
class VisualCategoryConfig:
    name: str
    rule_ids: tuple[str, ...]
    weight: float


class ScoringEngine:
    """Compute model, visual, and overall quality scores for a project."""

    ERROR_WEIGHT = 5
    WARNING_WEIGHT = 2

    MODEL_WEIGHT = 0.60
    VISUAL_WEIGHT = 0.40

    MODEL_CATEGORIES: tuple[ModelCategoryConfig, ...] = (
        ModelCategoryConfig("Performance", ("Performance",), 0.30),
        ModelCategoryConfig("DAX Quality", ("DAX Expressions",), 0.20),
        ModelCategoryConfig("Formatting", ("Formatting", "Model Layout"), 0.15),
        ModelCategoryConfig("Error Prevention", ("Error Prevention",), 0.15),
        ModelCategoryConfig("Maintenance", ("Maintenance", "Metadata"), 0.10),
        ModelCategoryConfig("Naming", ("Naming Conventions",), 0.10),
    )

    VISUAL_CATEGORIES: tuple[VisualCategoryConfig, ...] = (
        VisualCategoryConfig(
            "Layout & UX",
            (
                "CHARTS_WIDER_THAN_TALL",
                "MOBILE_CHARTS_WIDER_THAN_TALL",
                "CHECK_FOR_VISUALS_OVERLAP",
                "DISABLE_DROP_SHADOWS_ON_VISUALS",
            ),
            0.35,
        ),
        VisualCategoryConfig(
            "Accessibility & Standards",
            (
                "ENSURE_ALT_TEXT_DEFINED_FOR_VISUALS",
                "SHOW_AXES_TITLES",
                "GIVE_VISIBLE_PAGES_MEANINGFUL_NAMES",
                "ACTIVE_PAGE",
            ),
            0.35,
        ),
        VisualCategoryConfig(
            "Performance & Config",
            (
                "DISABLE_SLOW_DATASOURCE_SETTINGS",
                "LOCAL_REPORT_SETTINGS",
                "PERCENTAGE_OF_CHARTS_USING_CUSTOM_COLOURS",
                "CHECK_FOR_LOCAL_MEASURES",
            ),
            0.30,
        ),
    )

    @staticmethod
    def _grade_for_score(score: float) -> dict[str, str]:
        if score >= 90:
            return {"grade": "A", "label": "Excellent", "color": "#4caf50"}
        if score >= 75:
            return {"grade": "B", "label": "Good", "color": "#2196f3"}
        if score >= 60:
            return {"grade": "C", "label": "Needs Improvement", "color": "#ff9800"}
        if score >= 40:
            return {"grade": "D", "label": "Poor", "color": "#f44336"}
        return {"grade": "F", "label": "Critical", "color": "#9c27b0"}

    @classmethod
    def calculate_scores(cls, project_id: int, db_session: Any) -> dict[str, Any]:
        project = db_session.get(Project, project_id)
        if not project:
            raise ValueError("Project not found")

        model_size = (project.table_count or 0) + (project.measure_count or 0) + (project.column_count or 0)

        model_categories: list[dict[str, Any]] = []
        weighted_model_total = 0.0

        for category_cfg in cls.MODEL_CATEGORIES:
            errors = (
                db_session.query(BpaViolation)
                .filter(
                    BpaViolation.project_id == project_id,
                    BpaViolation.category.in_(category_cfg.raw_categories),
                    BpaViolation.severity == 3,
                )
                .count()
            )
            warnings = (
                db_session.query(BpaViolation)
                .filter(
                    BpaViolation.project_id == project_id,
                    BpaViolation.category.in_(category_cfg.raw_categories),
                    BpaViolation.severity == 2,
                )
                .count()
            )

            penalty = (errors * cls.ERROR_WEIGHT) + (warnings * cls.WARNING_WEIGHT)
            norm_factor = max(model_size * category_cfg.weight, 1)
            score = max(0.0, 100.0 - ((penalty / norm_factor) * 100.0))

            model_categories.append(
                {
                    "name": category_cfg.name,
                    "score": round(score, 2),
                    "weight": category_cfg.weight,
                    "penalty": penalty,
                    "errors": errors,
                    "warnings": warnings,
                    "norm_factor": round(norm_factor, 4),
                }
            )
            weighted_model_total += score * category_cfg.weight

        model_score = round(weighted_model_total, 2)

        visual_categories: list[dict[str, Any]] = []
        weighted_visual_total = 0.0
        for visual_cfg in cls.VISUAL_CATEGORIES:
            total_rules = (
                db_session.query(InspectorResult)
                .filter(
                    InspectorResult.project_id == project_id,
                    InspectorResult.rule_id.in_(visual_cfg.rule_ids),
                )
                .count()
            )
            passed_rules = (
                db_session.query(InspectorResult)
                .filter(
                    InspectorResult.project_id == project_id,
                    InspectorResult.rule_id.in_(visual_cfg.rule_ids),
                    InspectorResult.passed.is_(True),
                )
                .count()
            )

            score = 100.0 if total_rules == 0 else (passed_rules / total_rules) * 100.0
            visual_categories.append(
                {
                    "name": visual_cfg.name,
                    "score": round(score, 2),
                    "weight": visual_cfg.weight,
                    "passed": passed_rules,
                    "total": total_rules,
                    "rules": list(visual_cfg.rule_ids),
                }
            )
            weighted_visual_total += score * visual_cfg.weight

        visual_score = round(weighted_visual_total, 2)

        overall_score = round((cls.MODEL_WEIGHT * model_score) + (cls.VISUAL_WEIGHT * visual_score), 2)
        grade = cls._grade_for_score(overall_score)

        return {
            "overall_score": overall_score,
            "overall_grade": grade["grade"],
            "overall_label": grade["label"],
            "overall_color": grade["color"],
            "model_score": model_score,
            "model_categories": model_categories,
            "visual_score": visual_score,
            "visual_categories": visual_categories,
            "model_weight": cls.MODEL_WEIGHT,
            "visual_weight": cls.VISUAL_WEIGHT,
        }
