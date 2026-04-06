# BI Quality Analyzer — Scoring System

## Overview

The scoring system evaluates Power BI projects across two pillars: **Semantic Model Quality** (structural best practices) and **Visual Quality** (report-level compliance). Each pillar produces a 0–100 score, combined into a single **Overall Project Score** with a letter grade.

```
┌─────────────────────────────────────────────────────────────┐
│                    OVERALL PROJECT SCORE                     │
│                S = 0.6 × S_model + 0.4 × S_visual           │
├─────────────────────────────┬───────────────────────────────┤
│   SEMANTIC MODEL SCORE (60%)│    VISUAL QUALITY SCORE (40%) │
│        BPA-based            │       Inspector-based         │
│     6 category sub-scores   │     3 category sub-scores     │
│     Severity-weighted       │     Pass / Fail ratio         │
│     INFO excluded           │     Utility rules excluded    │
└─────────────────────────────┴───────────────────────────────┘
```

---

## Grade Scale

| Score Range | Grade | Label | Color |
|:-----------:|:-----:|-------|-------|
| 90 – 100 | **A** | Excellent | Green |
| 75 – 89 | **B** | Good | Blue |
| 60 – 74 | **C** | Needs Improvement | Yellow |
| 40 – 59 | **D** | Poor | Orange |
| 0 – 39 | **F** | Critical | Red |

---

## Pillar 1 — Semantic Model Score (`S_model`)

### Source Data

Violations detected by **Tabular Editor BPA** (Best Practice Analyzer) against 86 custom rules stored in `BPARules-Custom.json`.

### Severity Weights

| Severity | Label | Weight | Counted? |
|:--------:|-------|:------:|:--------:|
| 3 | ERROR | **5** | Yes |
| 2 | WARNING | **2** | Yes |
| 1 | INFO | **0** | **No — excluded from all formulas** |

**Rationale**: INFO rules are informational recommendations. They should appear in the violation list for developer awareness but must not penalize the quality score.

### Scoring Categories

The 8 raw BPA categories are grouped into 6 scoring categories, each with a weight reflecting its importance to model quality:

| Scoring Category | Maps From (BPA categories) | Weight | Rule Count |
|-----------------|---------------------------|:------:|:----------:|
| Performance | Performance | **0.30** | 27 |
| DAX Quality | DAX Expressions | **0.20** | 13 |
| Formatting | Formatting, Model Layout | **0.15** | 20 |
| Error Prevention | Error Prevention | **0.15** | 8 |
| Maintenance | Maintenance, Metadata | **0.10** | 10 |
| Naming | Naming Conventions | **0.10** | 8 |
| | | **1.00** | **86** |

### Formulas

**Step 1 — Weighted Violation Points per category**

For each category `c`, sum only ERROR and WARNING violations:

```
Penalty(c) = (error_count_in_c × 5) + (warning_count_in_c × 2)
```

**Step 2 — Normalization by model size**

To ensure fairness across models of different sizes (a model with 200 objects having 10 warnings is healthier than a model with 20 objects having 10 warnings):

```
ModelSize = table_count + measure_count + column_count

NormFactor(c) = max(ModelSize × CategoryWeight(c), 1)
```

The `max(..., 1)` prevents division by zero for empty models.

**Step 3 — Category score**

```
Score(c) = max(0,  100 − (Penalty(c) / NormFactor(c)) × 100)
```

Each category score is clamped between 0 and 100.

**Step 4 — Aggregate model score**

Weighted average across all 6 categories:

```
S_model = Σ (Score(c) × Weight(c))  /  Σ Weight(c)
```

Since weights sum to 1.00, this simplifies to:

```
S_model = Σ (Score(c) × Weight(c))
```

### Worked Example

| Category | Errors | Warnings | Penalty | NormFactor (ModelSize=150) | Score |
|----------|:------:|:--------:|:-------:|:-------------------------:|:-----:|
| Performance | 0 | 8 | 0×5 + 8×2 = 16 | 150 × 0.30 = 45 | max(0, 100 − 35.6) = **64.4** |
| DAX Quality | 2 | 3 | 2×5 + 3×2 = 16 | 150 × 0.20 = 30 | max(0, 100 − 53.3) = **46.7** |
| Formatting | 1 | 2 | 1×5 + 2×2 = 9 | 150 × 0.15 = 22.5 | max(0, 100 − 40.0) = **60.0** |
| Error Prevention | 3 | 0 | 3×5 + 0×2 = 15 | 150 × 0.15 = 22.5 | max(0, 100 − 66.7) = **33.3** |
| Maintenance | 0 | 1 | 0×5 + 1×2 = 2 | 150 × 0.10 = 15 | max(0, 100 − 13.3) = **86.7** |
| Naming | 0 | 4 | 0×5 + 4×2 = 8 | 150 × 0.10 = 15 | max(0, 100 − 53.3) = **46.7** |

```
S_model = (64.4 × 0.30) + (46.7 × 0.20) + (60.0 × 0.15) + (33.3 × 0.15) + (86.7 × 0.10) + (46.7 × 0.10)
S_model = 19.32 + 9.34 + 9.00 + 5.00 + 8.67 + 4.67
S_model = 56.0
```

---

## Pillar 2 — Visual Quality Score (`S_visual`)

### Source Data

Results from **PBI Inspector** — 16 binary rules (pass/fail) that validate report-level compliance.

### Rule Grouping

The 16 inspector rules are classified into 3 visual categories. **4 utility rules are excluded** from scoring as they are diagnostic, not quality indicators.

#### Layout & UX — Weight: 0.35

| Rule ID | Rule Name |
|---------|-----------|
| CHARTS_WIDER_THAN_TALL | Charts wider than tall |
| MOBILE_CHARTS_WIDER_THAN_TALL | Mobile charts wider than tall |
| CHECK_FOR_VISUALS_OVERLAP | Check for visuals overlap |
| DISABLE_DROP_SHADOWS_ON_VISUALS | Disable drop shadows on visuals |

#### Accessibility & Standards — Weight: 0.35

| Rule ID | Rule Name |
|---------|-----------|
| ENSURE_ALT_TEXT_DEFINED_FOR_VISUALS | Ensure alt-text defined for visuals |
| SHOW_AXES_TITLES | Show visual axes titles |
| GIVE_VISIBLE_PAGES_MEANINGFUL_NAMES | Give visible pages meaningful names |
| ACTIVE_PAGE | Active page set to first page |

#### Performance & Config — Weight: 0.30

| Rule ID | Rule Name |
|---------|-----------|
| DISABLE_SLOW_DATASOURCE_SETTINGS | Disable slow datasource settings |
| LOCAL_REPORT_SETTINGS | Local report settings |
| PERCENTAGE_OF_CHARTS_USING_CUSTOM_COLOURS | Charts using custom colours ≤ 10% |
| CHECK_FOR_LOCAL_MEASURES | Check for locally defined measures |

#### Excluded Rules (not scored)

| Rule ID | Reason |
|---------|--------|
| UNIQUE_PART_FAIL | Diagnostic utility |
| UNIQUE_PART_PASS | Diagnostic utility |
| CHECK_VERSION | Version check, not quality |
| VARY_BY_REPORT_NAME | Conditional/sample rule |

### Formulas

**Step 1 — Per-category pass rate**

For each visual category `v`:

```
Score(v) = (passed_rules_in_v / total_rules_in_v) × 100
```

**Note**: A single inspector rule may produce multiple results (one per page). For scoring, a rule is considered **passed** only if it passes on **all pages**. If it fails on any page, it counts as failed.

**Step 2 — Aggregate visual score**

Weighted average:

```
S_visual = Σ (Score(v) × Weight(v))
```

### Worked Example

| Visual Category | Passed | Total | Score | Weight |
|-----------------|:------:|:-----:|:-----:|:------:|
| Layout & UX | 3 | 4 | 75.0 | 0.35 |
| Accessibility & Standards | 2 | 4 | 50.0 | 0.35 |
| Performance & Config | 4 | 4 | 100.0 | 0.30 |

```
S_visual = (75.0 × 0.35) + (50.0 × 0.35) + (100.0 × 0.30)
S_visual = 26.25 + 17.50 + 30.00
S_visual = 73.75
```

---

## Overall Project Score

```
S_overall = 0.60 × S_model + 0.40 × S_visual
```

| Component | Weight | Rationale |
|-----------|:------:|-----------|
| Semantic Model | **60%** | The data model is the foundation — poor model quality cascades into report performance, maintenance cost, and data accuracy |
| Visual Quality | **40%** | Report compliance ensures usability, accessibility, and consistent user experience |

### Worked Example (continued)

```
S_overall = 0.60 × 56.0 + 0.40 × 73.75
S_overall = 33.6 + 29.5
S_overall = 63.1  →  Grade C ("Needs Improvement")
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **INFO excluded** | Informational rules are best-practice suggestions, not quality defects. Including them would inflate penalty counts and make scores unreliable. |
| **Severity weighting (5/2/0)** | ERRORs are critical issues that can cause data integrity problems or performance degradation. WARNINGs are improvement opportunities. The 2.5x ratio reflects this priority gap. |
| **Model size normalization** | Without normalization, large models (100+ tables) would always score lower than small models simply due to having more objects that can trigger violations. Dividing by `ModelSize × CategoryWeight` levels the playing field. |
| **60/40 split** | The semantic model is the structural backbone. Visual issues are important but more easily corrected and have less downstream impact. |
| **Category weights** | Performance (0.30) is highest because it directly impacts end-user experience. Error Prevention (0.15) catches data integrity risks. Naming (0.10) and Maintenance (0.10) are hygiene — important but less critical. |
| **Utility rules excluded** | UNIQUE_PART_*, CHECK_VERSION, and VARY_BY_REPORT_NAME are diagnostic/infrastructure rules, not quality indicators. Including them would distort the visual score. |
| **Per-page rule aggregation** | An inspector rule must pass on ALL pages to count as passed. A single page failure means the rule fails — this prevents masking page-specific issues. |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects/{id}/scores` | Full scoring breakdown (all categories, penalties, details) |
| `GET` | `/api/projects/{id}/scores/summary` | Compact: overall score, grade, label, model score, visual score |
| `GET` | `/api/projects/{id}/health-radar` | Radar chart data (uses model category scores) |

### Response: `/scores`

```json
{
  "overall_score": 63.1,
  "overall_grade": "C",
  "overall_label": "Needs Improvement",
  "overall_color": "#ff9800",
  "model_score": 56.0,
  "model_weight": 0.60,
  "model_categories": [
    {
      "name": "Performance",
      "score": 64.4,
      "weight": 0.30,
      "penalty": 16,
      "errors": 0,
      "warnings": 8,
      "norm_factor": 45
    }
  ],
  "visual_score": 73.75,
  "visual_weight": 0.40,
  "visual_categories": [
    {
      "name": "Layout & UX",
      "score": 75.0,
      "weight": 0.35,
      "passed": 3,
      "total": 4,
      "rules": ["CHARTS_WIDER_THAN_TALL", "..."]
    }
  ]
}
```

---

## Appendix: Full Rule Reference

### BPA Rules by Category and Severity

| Category | INFO (sev 1) | WARNING (sev 2) | ERROR (sev 3) | Total |
|----------|:------------:|:----------------:|:--------------:|:-----:|
| Performance | 4 | 22 | 1 | 27 |
| DAX Expressions | 1 | 9 | 3 | 13 |
| Formatting | 7 | 7 | 3 | 17 |
| Model Layout | 2 | 0 | 1 | 3 |
| Error Prevention | 0 | 1 | 7 | 8 |
| Maintenance | 5 | 4 | 0 | 9 |
| Metadata | 0 | 0 | 1 | 1 |
| Naming Conventions | 2 | 6 | 0 | 8 |
| **Total** | **21** | **49** | **16** | **86** |

### Inspector Rules by Visual Category

| Visual Category | Rule Count | Scored |
|-----------------|:----------:|:------:|
| Layout & UX | 4 | Yes |
| Accessibility & Standards | 4 | Yes |
| Performance & Config | 4 | Yes |
| Utility (excluded) | 4 | No |
| **Total** | **16** | **12 scored** |
