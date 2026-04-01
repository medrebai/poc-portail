# Claude Code Prompt — BI Quality Analyzer (Standalone Web App)

## Overview

Build a full-stack web application called **BI Quality Analyzer** — a standalone tool that lets users manually upload Power BI (.pbip) projects, then analyzes and displays model documentation, semantic model quality (BPA rules), and visual quality (PBI Inspector rules) in a rich, browsable UI.

**This is NOT connected to Azure DevOps.** Projects are created and uploaded manually by the user.

---

## Tech Stack (use latest stable versions)

| Layer | Technology |
|-------|-----------|
| Frontend | **Angular** (latest stable LTS, currently v19) with Angular Material for UI components |
| Backend | **Flask** (Python) with Flask-RESTful |
| Primary DB | **PostgreSQL** — stores project metadata + all analysis results as structured data |
| Document DB | **MongoDB** — stores raw JSON analysis outputs (model-catalog, bpa-results, inspector-results) |
| File Storage | Local disk (temporary uploads only — delete source files after analysis) |
| Export | Excel export via `openpyxl` |

---

## Architecture

```
Angular Frontend (SPA)
    ↕ REST API (JSON)
Flask Backend
    ├── /api/projects          → CRUD projects
    ├── /api/projects/:id/upload → Upload .pbip ZIP
    ├── /api/projects/:id/analyze → Trigger analysis
    ├── /api/projects/:id/catalog → Model documentation
    ├── /api/projects/:id/bpa     → BPA violations
    ├── /api/projects/:id/inspector → PBI Inspector results
    └── /api/projects/:id/export/:type → Excel export
    ↕
PostgreSQL (structured)     MongoDB (raw JSON documents)
```

---

## Database Schema

### PostgreSQL Tables

```sql
-- Projects registry
CREATE TABLE projects (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    status          VARCHAR(50) DEFAULT 'pending',  -- pending | analyzing | ready | error
    error_message   TEXT,
    -- Model summary (denormalized from catalog for quick display)
    table_count     INT,
    measure_count   INT,
    column_count    INT,
    relationship_count INT
);

-- BPA violations (structured for filtering/sorting)
CREATE TABLE bpa_violations (
    id              SERIAL PRIMARY KEY,
    project_id      INT REFERENCES projects(id) ON DELETE CASCADE,
    rule_id         VARCHAR(100) NOT NULL,
    rule_name       VARCHAR(255),
    category        VARCHAR(100),
    severity        INT,             -- 1=Info, 2=Warning, 3=Error
    severity_label  VARCHAR(20),
    object_type     VARCHAR(50),     -- Measure, Column, Table, etc.
    object_name     VARCHAR(255),
    table_name      VARCHAR(255),
    description     TEXT,
    fix_template    TEXT,            -- From BPAFixTemplates.json
    fix_steps       JSONB            -- From BPAFixTemplates.json
);

-- BPA summary by rule (for dashboard charts)
CREATE TABLE bpa_summary (
    id              SERIAL PRIMARY KEY,
    project_id      INT REFERENCES projects(id) ON DELETE CASCADE,
    rule_id         VARCHAR(100),
    rule_name       VARCHAR(255),
    category        VARCHAR(100),
    severity        INT,
    severity_label  VARCHAR(20),
    count           INT
);

-- PBI Inspector results (structured)
CREATE TABLE inspector_results (
    id                  SERIAL PRIMARY KEY,
    project_id          INT REFERENCES projects(id) ON DELETE CASCADE,
    rule_id             VARCHAR(100),
    rule_name           VARCHAR(255),
    rule_description    TEXT,
    page_name           VARCHAR(255),   -- ParentDisplayName
    passed              BOOLEAN,
    expected            JSONB,
    actual              JSONB
);

-- Model tables (from catalog)
CREATE TABLE model_tables (
    id              SERIAL PRIMARY KEY,
    project_id      INT REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(255),
    is_hidden       BOOLEAN DEFAULT FALSE,
    mode            VARCHAR(50),       -- import, directQuery
    column_count    INT,
    measure_count   INT,
    partition_count INT
);

-- Model columns
CREATE TABLE model_columns (
    id              SERIAL PRIMARY KEY,
    table_id        INT REFERENCES model_tables(id) ON DELETE CASCADE,
    project_id      INT REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(255),
    data_type       VARCHAR(50),
    is_hidden       BOOLEAN DEFAULT FALSE,
    format_string   VARCHAR(255),
    description     TEXT,
    display_folder  VARCHAR(255),
    source_column   VARCHAR(255)
);

-- Model measures
CREATE TABLE model_measures (
    id              SERIAL PRIMARY KEY,
    table_id        INT REFERENCES model_tables(id) ON DELETE CASCADE,
    project_id      INT REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(255),
    expression      TEXT,
    format_string   VARCHAR(255),
    description     TEXT,
    display_folder  VARCHAR(255),
    is_hidden       BOOLEAN DEFAULT FALSE
);

-- Model relationships
CREATE TABLE model_relationships (
    id              SERIAL PRIMARY KEY,
    project_id      INT REFERENCES projects(id) ON DELETE CASCADE,
    from_table      VARCHAR(255),
    from_column     VARCHAR(255),
    to_table        VARCHAR(255),
    to_column       VARCHAR(255),
    cross_filter    VARCHAR(50),
    from_cardinality VARCHAR(20),
    to_cardinality  VARCHAR(20),
    is_active       BOOLEAN DEFAULT TRUE
);

-- RLS roles
CREATE TABLE model_roles (
    id              SERIAL PRIMARY KEY,
    project_id      INT REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(255),
    filters         JSONB   -- array of {table, expression}
);
```

### MongoDB Collections

```
db.raw_results
{
    project_id: 1,
    type: "model_catalog" | "bpa_results" | "inspector_results",
    data: { ... full JSON output ... },
    created_at: ISODate()
}
```

---

## Backend — Flask API

### Project Lifecycle

1. **POST /api/projects** — Create project (name + description)
2. **POST /api/projects/:id/upload** — Upload `.pbip` ZIP file
   - Extracts to a temp directory: `uploads/<project_id>/`
   - Validates required structure: must contain `.SemanticModel/definition/` and `.Report/`
3. **POST /api/projects/:id/analyze** — Run full analysis pipeline:
   - **Step 1: TMDL Parsing** (Python — reimplemented from `parse-tmdl.py`)
     - Parse `model.tmdl`, `relationships.tmdl`, `roles/*.tmdl`, `tables/*.tmdl`
     - Produces `model-catalog.json` equivalent
     - Store structured data in PostgreSQL tables + raw JSON in MongoDB
   - **Step 2: BPA Analysis** (CLI — Tabular Editor 2)
     - Invoke: `TabularEditor.exe <model_path> -A <BPARules-Custom.json> -V`
     - Parse console output using logic from `parse-bpa-to-json.ps1`
     - Store structured violations in PostgreSQL + raw JSON in MongoDB
     - Match each violation to its fix template from `BPAFixTemplates.json`
   - **Step 3: PBI Inspector** (CLI — PBI Inspector 2.4.5)
     - Invoke: `PBIRInspectorCLI.exe -fabricitem <report_path> -rules <rules.json> -formats JSON -output <temp> -verbose true`
     - Parse JSON output
     - Store structured results in PostgreSQL + raw JSON in MongoDB
   - **Step 4: Cleanup** — Delete uploaded source files, keep only JSON results
   - Update project status to `ready`
4. **GET /api/projects** — List all projects with summary stats
5. **GET /api/projects/:id** — Project detail with full stats
6. **DELETE /api/projects/:id** — Delete project and all related data

### Analysis Data Endpoints

- **GET /api/projects/:id/catalog** — Full model documentation
  - Query params: `?table=<name>` (filter by table)
- **GET /api/projects/:id/catalog/tables** — All tables with columns/measures counts
- **GET /api/projects/:id/catalog/measures** — All measures across all tables
- **GET /api/projects/:id/catalog/relationships** — All relationships
- **GET /api/projects/:id/catalog/roles** — RLS roles

- **GET /api/projects/:id/bpa** — BPA violations
  - Query params: `?severity=`, `?category=`, `?ruleId=`, `?table=`, `?sort=`, `?order=`
- **GET /api/projects/:id/bpa/summary** — Summary by rule (for charts)

- **GET /api/projects/:id/inspector** — PBI Inspector results
  - Query params: `?passed=true|false`, `?page=`, `?sort=`

- **GET /api/projects/:id/export/bpa** — Excel export of BPA violations
- **GET /api/projects/:id/export/inspector** — Excel export of inspector results
- **GET /api/projects/:id/export/catalog** — Excel export of model catalog

### Configuration

The backend needs to know where CLI tools are installed. Use environment variables:

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/bi_quality
MONGODB_URI=mongodb://localhost:27017/bi_quality

# CLI Tools (Windows paths)
TABULAR_EDITOR_PATH=C:\Program Files (x86)\Tabular Editor\TabularEditor.exe
PBI_INSPECTOR_PATH=C:\Tools\win-x64\CLI\PBIRInspectorCLI.exe

# Analysis rules (bundled with the app)
BPA_RULES_PATH=./rules/BPARules-Custom.json
BPA_FIX_TEMPLATES_PATH=./rules/BPAFixTemplates.json
PBI_INSPECTOR_RULES_PATH=./rules/pbi-inspector-rules.json

# Upload
UPLOAD_FOLDER=./uploads
MAX_UPLOAD_SIZE=100MB
```

### Key Implementation Details

#### TMDL Parser (Python — port from parse-tmdl.py)

The TMDL parser must handle:
- `model.tmdl`: culture, autoDateTime, defaultPowerBIDataSourceVersion, table references
- `relationships.tmdl`: fromTable/Column, toTable/Column, crossFilter, cardinality, isActive
- `tables/*.tmdl`: Each file contains one table with columns, measures, partitions
  - **Columns**: name, dataType, isHidden, formatString, description, displayFolder, sourceColumn
  - **Measures**: name, expression (single-line AND backtick-fenced multiline), formatString, description, displayFolder, isHidden
  - **Partitions**: name, mode, source type, M expression
- `roles/*.tmdl`: role name, table permissions with filter expressions
- Must skip auto-generated tables: `LocalDateTable_*` and `DateTableTemplate_*`

#### BPA Analysis (CLI invocation)

```python
import subprocess

def run_bpa(model_path, rules_path, te_path):
    """Run Tabular Editor BPA and capture console output."""
    result = subprocess.run(
        [te_path, model_path, "-A", rules_path, "-V"],
        capture_output=True, text=True, encoding='utf-8'
    )
    # Exit code 0 = no violations, 1 = violations found (both OK)
    # Exit code 2+ = crash
    if result.returncode >= 2:
        raise RuntimeError(f"Tabular Editor crashed: {result.stderr}")
    return result.stdout  # Parse this with parse-bpa-to-json logic
```

The BPA console output format is:
```
[WARNING] 'TableName'[ObjectName] violates rule "Rule Name" (Category)
```
Parse each line, extract severity, object reference, rule name, category.

Then cross-reference with `BPARules-Custom.json` to get ruleId, full description, and severity level.
And cross-reference with `BPAFixTemplates.json` to attach fix templates and steps.

#### PBI Inspector (CLI invocation)

```python
def run_inspector(report_path, rules_path, inspector_path, output_dir):
    """Run PBI Inspector CLI and parse JSON output."""
    result = subprocess.run(
        [inspector_path,
         "-fabricitem", report_path,
         "-rules", rules_path,
         "-formats", "JSON",
         "-output", output_dir,
         "-verbose", "true"],
        capture_output=True, text=True
    )
    # Find generated TestRun_*.json file
    # Parse it — structure matches pbi-inspector-results.json
```

---

## Frontend — Angular

### No authentication. Single-user local tool.

### Pages & Navigation

```
/                       → Redirect to /projects
/projects               → Project List (dashboard)
/projects/new           → Create New Project (form + upload)
/projects/:id           → Project Overview (summary dashboard)
/projects/:id/catalog   → Model Documentation (browsable)
/projects/:id/bpa       → BPA Violations (semantic model quality)
/projects/:id/inspector → PBI Inspector Results (visual quality)
```

### Page 1: Project List (`/projects`)

- Card grid or table showing all projects
- Each card shows: name, description, status badge, created date, quick stats (tables/measures/violations)
- "New Project" button → navigates to creation page
- Delete button per project (with confirmation dialog)

### Page 2: Create Project (`/projects/new`)

- **Step 1**: Form with project name (required) and description (optional)
- **Step 2**: File upload zone (drag & drop + browse) for `.pbip` ZIP file
  - The ZIP should contain at minimum:
    - `*.SemanticModel/definition/` folder with TMDL files
    - `*.Report/` folder with report JSON files
    - `*.pbip` file (optional but expected)
  - Show validation feedback after upload
- **Step 3**: Click "Analyze" button → triggers backend analysis
  - Show progress indicator with steps: "Parsing TMDL..." → "Running BPA..." → "Running PBI Inspector..." → "Done"
  - On completion, navigate to project overview

### Page 3: Project Overview (`/projects/:id`)

- **Header**: Project name, description, status, created date
- **Summary cards row**:
  - Tables count
  - Measures count  
  - Columns count
  - Relationships count
  - BPA Violations (with severity breakdown: X errors, Y warnings)
  - Inspector Failed Rules count
- **Navigation buttons** (prominent) to:
  - 📖 Model Documentation
  - 🔍 Semantic Model Quality (BPA)
  - 🎨 Visual Quality (Inspector)
- **Quick charts**:
  - BPA violations by category (bar chart)
  - BPA violations by severity (donut chart)
  - Inspector pass/fail ratio (donut chart)

### Page 4: Model Documentation (`/projects/:id/catalog`)

This is the **richest page** — a fully browsable, filterable view of the entire Power BI model.

**Layout**: Tabbed interface with 4 tabs:

#### Tab: Tables
- Data table with columns: Table Name, Mode (Import/DirectQuery), Columns Count, Measures Count, Hidden (badge), Partitions
- Click a row → expands to show that table's columns and measures inline
- **Filters**: search by name, filter by mode, show/hide hidden tables
- **Sort**: by any column

#### Tab: Measures
- Data table: Measure Name, Table, Expression (truncated, click to expand), Format String, Display Folder, Hidden
- **Filters**: search by name, filter by table, filter by display folder
- Click a measure → modal/side panel showing full DAX expression with syntax highlighting (use a code block with DAX formatting)
- **Sort**: by name, table, display folder

#### Tab: Relationships
- Data table: From Table → From Column, To Table → To Column, Cardinality (many-to-one, etc.), Cross Filter, Active/Inactive badge
- Visual: optional simple relationship diagram (nice to have, not required)
- **Filters**: filter by table name, filter active/inactive
- **Sort**: by any column

#### Tab: RLS Roles
- Accordion or card layout: each role name with its filter expressions
- Show table name + DAX filter expression per permission

**Global features on this page**:
- "Export to Excel" button → exports all catalog data (one sheet per tab: Tables, Columns, Measures, Relationships, Roles)

### Page 5: BPA Violations (`/projects/:id/bpa`)

**Header**: Summary bar showing total violations, errors count, warnings count, info count

**Main content**: Sortable, filterable data table:

| Column | Description |
|--------|------------|
| Severity | Icon + badge: 🔴 Error / ⚠️ Warning / 🔵 Info |
| Category | DAX Expressions, Naming Conventions, Performance, Formatting, Model Layout |
| Rule Name | Full rule name |
| Object | Table[Object] reference |
| Object Type | Measure, Column, Table |
| Fix | Expandable — shows fix template + steps from BPAFixTemplates.json |

**Filters sidebar or toolbar**:
- Severity: checkboxes (Error, Warning, Info)
- Category: checkboxes (all categories from rules)
- Table: dropdown/search
- Rule: dropdown/search
- Object Type: checkboxes

**Grouping**: Toggle to group by Category or by Rule

**Charts section** (collapsible, above the table):
- Violations by category (horizontal bar chart)
- Violations by severity (donut)
- Top 10 rules by violation count

**Export**: "Export to Excel" button

### Page 6: PBI Inspector Results (`/projects/:id/inspector`)

**Header**: Summary bar showing total rules, passed count, failed count

**Main content**: Data table:

| Column | Description |
|--------|------------|
| Status | ✅ Passed / ❌ Failed badge |
| Rule Name | Full rule name |
| Description | Rule description |
| Page | ParentDisplayName (which report page) or "Report level" |
| Details | Expandable — for failed rules, show Expected vs Actual diff |

**Filters**:
- Status: Passed / Failed toggle
- Page: dropdown

**Charts**:
- Pass/Fail ratio (donut)
- Failed rules by page (bar chart)

**Export**: "Export to Excel" button

---

## Bundled Rule Files

The app must bundle these rule files (copy them into the project):

1. **`rules/BPARules-Custom.json`** — 26 BPA rules with ID, Name, Category, Description, Severity, Scope, Expression
2. **`rules/BPAFixTemplates.json`** — 71 fix templates with ruleId, template text (with `{object}` and `{table}` placeholders), and step-by-step fix instructions  
3. **`rules/pbi-inspector-rules.json`** — PBI Inspector visual rules in JSONLogic format

---

## Project Structure

```
bi-quality-analyzer/
├── backend/
│   ├── app/
│   │   ├── __init__.py          (Flask app factory)
│   │   ├── config.py            (Config from env vars)
│   │   ├── models/              (SQLAlchemy models)
│   │   │   ├── project.py
│   │   │   ├── bpa.py
│   │   │   ├── inspector.py
│   │   │   └── catalog.py
│   │   ├── routes/
│   │   │   ├── projects.py
│   │   │   ├── catalog.py
│   │   │   ├── bpa.py
│   │   │   ├── inspector.py
│   │   │   └── export.py
│   │   ├── services/
│   │   │   ├── tmdl_parser.py    (Python TMDL parser — ported from parse-tmdl.py)
│   │   │   ├── bpa_analyzer.py   (CLI invocation + output parsing)
│   │   │   ├── inspector_analyzer.py  (CLI invocation + output parsing)
│   │   │   ├── fix_matcher.py    (Match violations to BPAFixTemplates)
│   │   │   └── export_service.py (Excel generation with openpyxl)
│   │   └── utils/
│   │       ├── file_handler.py   (ZIP extraction, validation, cleanup)
│   │       └── mongo_client.py   (MongoDB connection helper)
│   ├── rules/
│   │   ├── BPARules-Custom.json
│   │   ├── BPAFixTemplates.json
│   │   └── pbi-inspector-rules.json
│   ├── requirements.txt
│   ├── .env.example
│   └── run.py
├── frontend/
│   └── (Angular CLI generated project)
│       ├── src/app/
│       │   ├── pages/
│       │   │   ├── project-list/
│       │   │   ├── project-create/
│       │   │   ├── project-overview/
│       │   │   ├── model-catalog/
│       │   │   ├── bpa-violations/
│       │   │   └── inspector-results/
│       │   ├── services/
│       │   │   ├── project.service.ts
│       │   │   ├── catalog.service.ts
│       │   │   ├── bpa.service.ts
│       │   │   └── inspector.service.ts
│       │   ├── shared/
│       │   │   ├── components/     (reusable: severity-badge, filter-panel, chart-card)
│       │   │   └── models/         (TypeScript interfaces)
│       │   └── app.routes.ts
│       └── angular.json
├── docker-compose.yml           (PostgreSQL + MongoDB)
└── README.md
```

---

## Implementation Order

### Phase 1: Backend Foundation
1. Flask app setup with SQLAlchemy + PostgreSQL
2. MongoDB connection
3. Project CRUD endpoints
4. File upload + ZIP extraction + validation

### Phase 2: Analysis Engine
5. TMDL parser service (Python port)
6. BPA analyzer service (CLI invocation + parsing)
7. PBI Inspector service (CLI invocation + parsing)
8. Fix template matcher
9. Analysis orchestration endpoint

### Phase 3: Data API
10. Catalog endpoints (tables, measures, relationships, roles)
11. BPA endpoints (with filtering/sorting)
12. Inspector endpoints (with filtering)
13. Excel export endpoints

### Phase 4: Angular Frontend
14. Angular project setup with Angular Material
15. Project list page
16. Project creation + upload page
17. Project overview dashboard
18. Model catalog page (4 tabs, fully browsable)
19. BPA violations page (filters, sorting, grouping, charts)
20. Inspector results page (filters, charts)

---

## Important Notes

- **No authentication** — this is a single-user local development tool
- **Windows-only for CLI tools** — Tabular Editor and PBI Inspector are Windows executables. The Flask backend must run on Windows or use subprocess with proper Windows path handling
- **Uploaded files are temporary** — after analysis completes, delete the extracted `.pbip` source files. Only keep the JSON analysis results in MongoDB and structured data in PostgreSQL
- **BPA violations are informational** — never show pass/fail status. Show severity levels (Error/Warning/Info) as informational badges, not blocking indicators
- **Fix templates use placeholders** — `{object}` and `{table}` in BPAFixTemplates.json must be replaced with actual object/table names when displaying
- **Skip auto-generated tables** — Filter out `LocalDateTable_*` and `DateTableTemplate_*` from all views
- **CORS** — Enable CORS in Flask for Angular dev server (localhost:4200 → localhost:5000)

---

## Start with the backend first. Build and test each service independently before wiring up the API routes. Then build the Angular frontend page by page.