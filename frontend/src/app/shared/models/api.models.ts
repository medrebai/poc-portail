export interface Project {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  status: 'pending' | 'analyzing' | 'ready' | 'error' | string;
  error_message?: string | null;
  table_count?: number;
  measure_count?: number;
  column_count?: number;
  relationship_count?: number;
  data_source_count?: number;
  visual_count?: number;
  data_sources?: string[];
  bpa_violation_count?: number;
  bpa_error_count?: number;
  bpa_warning_count?: number;
  bpa_info_count?: number;
  inspector_total?: number;
  inspector_passed_count?: number;
  inspector_failed_count?: number;
  analysis_meta?: {
    bpa_rules_path?: string;
    bpa_fix_templates_path?: string;
    pbi_inspector_rules_path?: string;
    tabular_editor_path?: string;
    pbi_inspector_path?: string;
  };
}

export interface CatalogTable {
  id: number;
  project_id: number;
  name: string;
  is_hidden: boolean;
  mode: string;
  column_count: number;
  measure_count: number;
  partition_count: number;
  columns?: CatalogColumn[];
  measures?: CatalogMeasure[];
}

export interface CatalogColumn {
  id: number;
  table_id: number;
  project_id: number;
  name: string;
  data_type?: string;
  is_hidden: boolean;
  format_string?: string;
  description?: string;
  display_folder?: string;
  source_column?: string;
}

export interface CatalogMeasure {
  id: number;
  table_id: number;
  project_id: number;
  name: string;
  expression?: string;
  format_string?: string;
  description?: string;
  display_folder?: string;
  is_hidden: boolean;
  table_name?: string;
}

export interface CatalogRelationship {
  id: number;
  project_id: number;
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  cross_filter: string;
  from_cardinality: string;
  to_cardinality: string;
  is_active: boolean;
}

export interface CatalogRole {
  id: number;
  project_id: number;
  name: string;
  filters: Array<{ table: string; expression: string }>;
}

export interface CatalogResponse {
  project: Project;
  summary: {
    table_count: number;
    measure_count: number;
    column_count: number;
    relationship_count: number;
  };
  tables: CatalogTable[];
  relationships: CatalogRelationship[];
  roles: CatalogRole[];
}

export interface BpaViolation {
  id: number;
  project_id: number;
  rule_id: string;
  rule_name: string;
  category: string;
  severity: number;
  severity_label: string;
  object_type: string;
  object_name: string;
  table_name: string;
  description: string;
  fix_template?: string;
  fix_steps?: { action?: string; steps?: string[]; warning?: string };
}

export interface BpaSummary {
  id: number;
  project_id: number;
  rule_id: string;
  rule_name: string;
  category: string;
  severity: number;
  severity_label: string;
  count: number;
}

export interface InspectorResult {
  id: number;
  project_id: number;
  rule_id: string;
  rule_name: string;
  rule_description: string;
  page_name: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
}
