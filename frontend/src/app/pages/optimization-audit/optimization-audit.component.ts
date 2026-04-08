import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
import { CatalogService } from '../../services/catalog.service';
import { LineageEdge, LineageNode, LineageService } from '../../services/lineage.service';
import { ProjectService } from '../../services/project.service';
import {
  CatalogColumn,
  CatalogMeasure,
  CatalogRelationship,
  CatalogResponse,
  CatalogTable,
  Project,
} from '../../shared/models/api.models';
import { SeverityBadgeComponent } from '../../shared/components/severity-badge/severity-badge.component';

type FindingSeverity = 'High' | 'Medium' | 'Low';
type FindingConfidence = 'High' | 'Medium';
type FindingType = 'Column' | 'Measure' | 'Table' | 'Relationship';
type UsageStatus = 'unused' | 'dependency-only' | 'used';
type VisibilityStatus = 'Hidden' | 'Visible' | 'N/A';

interface OptimizationFinding {
  checkId: number;
  checkLabel: string;
  objectType: FindingType;
  objectName: string;
  tableName: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  usageStatus: UsageStatus;
  visibility: VisibilityStatus;
  reason: string;
  recommendation: string;
  whyFlagged: string[];
  safeToRemove: boolean;
}

interface TableColumnRef {
  table: CatalogTable;
  column: CatalogColumn;
}

interface TableMeasureRef {
  table: CatalogTable;
  measure: CatalogMeasure;
}

@Component({
  selector: 'app-optimization-audit',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    SeverityBadgeComponent,
  ],
  templateUrl: './optimization-audit.component.html',
  styleUrl: './optimization-audit.component.scss',
})
export class OptimizationAuditComponent {
  readonly projectId: number;
  project: Project | null = null;
  catalog: CatalogResponse | null = null;
  findings: OptimizationFinding[] = [];
  loading = true;

  readonly checkFilter = new FormControl('all', { nonNullable: true });
  readonly typeFilter = new FormControl('all', { nonNullable: true });
  readonly severityFilter = new FormControl('all', { nonNullable: true });
  readonly searchFilter = new FormControl('', { nonNullable: true });
  readonly safeOnlyFilter = new FormControl('all', { nonNullable: true });
  readonly tableFilter = new FormControl('all', { nonNullable: true });
  readonly usageStatusFilter = new FormControl('all', { nonNullable: true });
  readonly visibilityFilter = new FormControl('all', { nonNullable: true });

  currentPage = 1;
  readonly pageSize = 10;

  private readonly technicalColumnPattern = /(^id$|_id$|^id_|_key$|_code$|_guid$|^fk_|^pk_)/i;
  private readonly largeTextNamePattern = /(description|comment|notes?|message|detail|html|json|xml|blob|address)/i;
  private readonly calcColumnNamePattern = /(calc|ratio|rate|percent|pct|score|index|amount|total|value|margin)/i;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly projectService: ProjectService,
    private readonly catalogService: CatalogService,
    private readonly lineageService: LineageService,
  ) {
    this.projectId = Number(this.route.snapshot.paramMap.get('id'));
    this.loadOptimizationContext();

    this.checkFilter.valueChanges.subscribe(() => (this.currentPage = 1));
    this.typeFilter.valueChanges.subscribe(() => (this.currentPage = 1));
    this.severityFilter.valueChanges.subscribe(() => (this.currentPage = 1));
    this.searchFilter.valueChanges.subscribe(() => (this.currentPage = 1));
    this.safeOnlyFilter.valueChanges.subscribe(() => (this.currentPage = 1));
    this.tableFilter.valueChanges.subscribe(() => (this.currentPage = 1));
    this.usageStatusFilter.valueChanges.subscribe(() => (this.currentPage = 1));
    this.visibilityFilter.valueChanges.subscribe(() => (this.currentPage = 1));
  }

  private loadOptimizationContext(): void {
    this.loading = true;
    forkJoin({
      project: this.projectService.getById(this.projectId),
      catalog: this.catalogService.getCatalog(this.projectId),
      lineage: this.lineageService.getFullLineage(this.projectId),
    }).subscribe({
      next: ({ project, catalog, lineage }) => {
        this.project = project;
        this.catalog = catalog;
        this.findings = this.buildFindings(catalog, lineage.nodes, lineage.edges);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  private buildFindings(catalog: CatalogResponse, nodes: LineageNode[], edges: LineageEdge[]): OptimizationFinding[] {
    const allColumns = this.allColumns(catalog.tables);
    const allMeasures = this.allMeasures(catalog.tables);

    const usedColumns = this.collectUsedColumns(nodes, edges, catalog.relationships);
    const visualColumns = this.collectVisualColumns(nodes, edges);
    const visualMeasures = this.collectVisualMeasures(nodes, edges);
    const dependencyMeasures = this.collectDependencyMeasures(nodes, edges);
    const daxActivatedRelationships = this.collectDaxActivatedRelationships(allMeasures);
    const columnMetadataMap = this.buildColumnMetadataMap(nodes);

    const usedMeasures = new Set<string>([...visualMeasures, ...dependencyMeasures]);

    const relationshipTables = new Set<string>(
      catalog.relationships.flatMap((rel) => [rel.from_table.toLowerCase(), rel.to_table.toLowerCase()])
    );

    const findings: OptimizationFinding[] = [];

    // 1. Unused columns
    for (const ref of allColumns) {
      const key = this.makeKey(ref.table.name, ref.column.name);
      if (!usedColumns.has(key)) {
        findings.push({
          checkId: 1,
          checkLabel: 'Unused Columns',
          objectType: 'Column',
          objectName: ref.column.name,
          tableName: ref.table.name,
          severity: 'High',
          confidence: 'High',
          usageStatus: 'unused',
          visibility: ref.column.is_hidden ? 'Hidden' : 'Visible',
          reason: 'No visual, measure, or relationship usage was detected.',
          recommendation: 'Review and remove this column or hide it if kept for compatibility.',
          whyFlagged: [
            `Column key ${key} was not present in lineage usage sets.`,
            'No visual reference and no relationship endpoint reference were detected.',
          ],
          safeToRemove: !ref.column.is_hidden,
        });
      }
    }

    // 2. Unused measures
    const dependencyOnlyMeasures = new Set<string>();
    for (const ref of allMeasures) {
      const key = this.makeKey(ref.table.name, ref.measure.name);
      const inVisual = visualMeasures.has(key);
      const inDependency = dependencyMeasures.has(key);

      if (!inVisual && !inDependency) {
        findings.push({
          checkId: 2,
          checkLabel: 'Unused Measures',
          objectType: 'Measure',
          objectName: ref.measure.name,
          tableName: ref.table.name,
          severity: 'High',
          confidence: 'High',
          usageStatus: 'unused',
          visibility: ref.measure.is_hidden ? 'Hidden' : 'Visible',
          reason: 'No report visual or measure dependency references were found.',
          recommendation: 'Remove the measure or move it to an archive table if it is not needed.',
          whyFlagged: [
            `Measure key ${key} is absent from visual uses and depends-on graph.`,
            'No visual binds and no dependent measures reference it.',
          ],
          safeToRemove: true,
        });
      }

      if (!inVisual && inDependency) {
        dependencyOnlyMeasures.add(key);
      }
    }

    // 3. Unused tables
    for (const table of catalog.tables) {
      const hasUsedColumn = (table.columns || []).some((column) => usedColumns.has(this.makeKey(table.name, column.name)));
      const hasUsedMeasure = (table.measures || []).some((measure) => usedMeasures.has(this.makeKey(table.name, measure.name)));
      const inRelationship = relationshipTables.has(table.name.toLowerCase());

      if (!hasUsedColumn && !hasUsedMeasure && !inRelationship) {
        findings.push({
          checkId: 3,
          checkLabel: 'Unused Tables',
          objectType: 'Table',
          objectName: table.name,
          tableName: table.name,
          severity: 'High',
          confidence: 'High',
          usageStatus: 'unused',
          visibility: table.is_hidden ? 'Hidden' : 'Visible',
          reason: 'No active lineage or relationship references were found for this table.',
          recommendation: 'Consider removing the table or excluding it from refresh.',
          whyFlagged: [
            'No column or measure from this table is used by visuals/dependencies.',
            'Table does not appear in any relationship endpoint.',
          ],
          safeToRemove: true,
        });
      }
    }

    // 4. Bi-directional relationships that may be unnecessary
    for (const rel of catalog.relationships) {
      if ((rel.cross_filter || '').toLowerCase().includes('both')) {
        const fromKey = this.makeKey(rel.from_table, rel.from_column);
        const toKey = this.makeKey(rel.to_table, rel.to_column);
        const endpointUsedInVisual = visualColumns.has(fromKey) || visualColumns.has(toKey);
        findings.push({
          checkId: 4,
          checkLabel: 'Bi-Directional Relationships May Be Unnecessary',
          objectType: 'Relationship',
          objectName: `${rel.from_table}.${rel.from_column} -> ${rel.to_table}.${rel.to_column}`,
          tableName: rel.from_table,
          severity: 'Medium',
          confidence: endpointUsedInVisual ? 'High' : 'Medium',
          usageStatus: endpointUsedInVisual ? 'used' : 'dependency-only',
          visibility: 'N/A',
          reason: 'Bi-directional cross filtering can increase ambiguity and query cost; validate if one-way filter is enough.',
          recommendation: 'Review whether single-direction filtering can satisfy the report behavior.',
          whyFlagged: [
            `Relationship cross_filter is set to "${rel.cross_filter}" (contains both).`,
            endpointUsedInVisual
              ? 'At least one endpoint column is used by visuals, so review impact before changing.'
              : 'Neither endpoint appears in visual field bindings, which can indicate unnecessary bi-directional flow.',
          ],
          safeToRemove: false,
        });
      }
    }

    // 5. Inactive relationships that are never activated in DAX
    for (const rel of catalog.relationships) {
      const relKey = this.normalizeRelationshipKey(rel.from_table, rel.from_column, rel.to_table, rel.to_column);
      if (!rel.is_active && !daxActivatedRelationships.has(relKey)) {
        findings.push({
          checkId: 5,
          checkLabel: 'Inactive Relationships Never Activated In DAX',
          objectType: 'Relationship',
          objectName: `${rel.from_table}.${rel.from_column} -> ${rel.to_table}.${rel.to_column}`,
          tableName: rel.from_table,
          severity: 'Medium',
          confidence: 'High',
          usageStatus: 'unused',
          visibility: 'N/A',
          reason: 'Relationship is inactive and no USERELATIONSHIP activation was detected in measure DAX.',
          recommendation: 'Validate if this relationship is still needed and remove unused ones.',
          whyFlagged: [
            'is_active = false on relationship metadata.',
            'No USERELATIONSHIP() call matching this endpoint pair was found in model measures.',
          ],
          safeToRemove: false,
        });
      }
    }

    // 6. Hidden measures never used in visuals
    for (const ref of allMeasures) {
      const key = this.makeKey(ref.table.name, ref.measure.name);
      if (ref.measure.is_hidden && !visualMeasures.has(key)) {
        findings.push({
          checkId: 6,
          checkLabel: 'Hidden Measures Not Used In Visuals',
          objectType: 'Measure',
          objectName: ref.measure.name,
          tableName: ref.table.name,
          severity: 'Low',
          confidence: dependencyOnlyMeasures.has(key) ? 'Medium' : 'High',
          usageStatus: dependencyOnlyMeasures.has(key) ? 'dependency-only' : 'unused',
          visibility: 'Hidden',
          reason: dependencyOnlyMeasures.has(key)
            ? 'Hidden measure is not used in visuals and appears only in measure dependencies.'
            : 'Hidden measure is not used by visuals or downstream calculations.',
          recommendation: dependencyOnlyMeasures.has(key)
            ? 'Keep if part of a reusable measure chain, otherwise consolidate and remove.'
            : 'Remove or merge it with other calculations if no longer needed.',
          whyFlagged: [
            'Measure visibility is hidden.',
            dependencyOnlyMeasures.has(key)
              ? 'Measure appears only in measure dependency graph and never in visual binding.'
              : 'Measure is absent from both visual bindings and dependency graph.',
          ],
          safeToRemove: !dependencyOnlyMeasures.has(key),
        });
      }
    }

    // 7. Visible technical columns
    for (const ref of allColumns) {
      if (!ref.column.is_hidden && this.technicalColumnPattern.test(ref.column.name)) {
        findings.push({
          checkId: 7,
          checkLabel: 'Visible Technical Columns',
          objectType: 'Column',
          objectName: ref.column.name,
          tableName: ref.table.name,
          severity: 'Low',
          confidence: 'Medium',
          usageStatus: visualColumns.has(this.makeKey(ref.table.name, ref.column.name)) ? 'used' : 'unused',
          visibility: 'Visible',
          reason: 'Technical key-like columns are visible to report authors/users.',
          recommendation: 'Hide technical columns that are not intended for report consumption.',
          whyFlagged: [
            `Column name matches technical pattern ${this.technicalColumnPattern}.`,
            'Column is currently visible in the model.',
          ],
          safeToRemove: false,
        });
      }
    }

    // 8. Measures without format string
    for (const ref of allMeasures) {
      const key = this.makeKey(ref.table.name, ref.measure.name);
      if (!(ref.measure.format_string || '').trim()) {
        findings.push({
          checkId: 8,
          checkLabel: 'Measures Without Format String',
          objectType: 'Measure',
          objectName: ref.measure.name,
          tableName: ref.table.name,
          severity: 'Low',
          confidence: 'High',
          usageStatus: this.resolveMeasureUsageStatus(key, visualMeasures, dependencyMeasures),
          visibility: ref.measure.is_hidden ? 'Hidden' : 'Visible',
          reason: 'No explicit measure formatting is defined.',
          recommendation: 'Set a consistent format string to improve report readability and avoid implicit formatting.',
          whyFlagged: [
            'format_string is empty or whitespace.',
            'Implicit formatting can lead to inconsistent report presentation.',
          ],
          safeToRemove: false,
        });
      }
    }

    // 9. Large text columns not used in visuals
    for (const ref of allColumns) {
      const key = this.makeKey(ref.table.name, ref.column.name);
      if (this.isLikelyLargeTextColumn(ref.column) && !visualColumns.has(key)) {
        findings.push({
          checkId: 9,
          checkLabel: 'Large Text Columns Not Used In Visuals',
          objectType: 'Column',
          objectName: ref.column.name,
          tableName: ref.table.name,
          severity: 'Medium',
          confidence: 'Medium',
          usageStatus: usedColumns.has(key) ? 'dependency-only' : 'unused',
          visibility: ref.column.is_hidden ? 'Hidden' : 'Visible',
          reason: 'Large text-like column appears unused in visuals and may add memory/model noise.',
          recommendation: 'Hide, remove, or move this column to detail-level exports if not required in report visuals.',
          whyFlagged: [
            `Column data type "${ref.column.data_type || 'unknown'}" looks text-like and column name suggests long text content.`,
            'No uses_field visual binding found for this column.',
          ],
          safeToRemove: false,
        });
      }
    }

    // 10. Calculated columns that could be measures
    for (const ref of allColumns) {
      const key = this.makeKey(ref.table.name, ref.column.name);
      const metadata = columnMetadataMap.get(key);
      if (this.isPotentialCalculatedColumn(ref.column, metadata) && this.isNumericDataType(ref.column.data_type || '')) {
        findings.push({
          checkId: 10,
          checkLabel: 'Calculated Columns That Could Be Measures',
          objectType: 'Column',
          objectName: ref.column.name,
          tableName: ref.table.name,
          severity: 'Medium',
          confidence: metadata?.['is_calculated'] || metadata?.['expression'] ? 'High' : 'Medium',
          usageStatus: visualColumns.has(key) ? 'used' : usedColumns.has(key) ? 'dependency-only' : 'unused',
          visibility: ref.column.is_hidden ? 'Hidden' : 'Visible',
          reason: 'Numeric calculated-like column may be better modeled as a measure depending on aggregation intent.',
          recommendation: 'Review whether this logic should be moved to a measure to reduce cardinality/storage impact.',
          whyFlagged: [
            metadata?.['is_calculated'] || metadata?.['expression']
              ? 'Lineage metadata indicates this column is calculated.'
              : 'Column naming/source patterns suggest a calculated business metric.',
            `Numeric data type detected: ${ref.column.data_type || 'unknown'}.`,
          ],
          safeToRemove: false,
        });
      }
    }

    return findings.sort((a, b) => {
      if (a.checkId !== b.checkId) return a.checkId - b.checkId;
      if (a.tableName !== b.tableName) return a.tableName.localeCompare(b.tableName);
      return a.objectName.localeCompare(b.objectName);
    });
  }

  private allColumns(tables: CatalogTable[]): TableColumnRef[] {
    const rows: TableColumnRef[] = [];
    for (const table of tables) {
      for (const column of table.columns || []) {
        rows.push({ table, column });
      }
    }
    return rows;
  }

  private allMeasures(tables: CatalogTable[]): TableMeasureRef[] {
    const rows: TableMeasureRef[] = [];
    for (const table of tables) {
      for (const measure of table.measures || []) {
        rows.push({ table, measure: { ...measure, table_name: measure.table_name || table.name } });
      }
    }
    return rows;
  }

  private collectUsedColumns(nodes: LineageNode[], edges: LineageEdge[], relationships: CatalogRelationship[]): Set<string> {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const used = new Set<string>();

    for (const edge of edges) {
      const toNode = nodeMap.get(edge.to);
      if (!toNode || toNode.type !== 'column') continue;

      if (edge.type === 'references_column' || edge.type === 'uses_field') {
        const table = ((toNode.metadata?.['table'] as string | undefined) || '').trim();
        if (table) {
          used.add(this.makeKey(table, toNode.name));
        }
      }
    }

    for (const rel of relationships) {
      used.add(this.makeKey(rel.from_table, rel.from_column));
      used.add(this.makeKey(rel.to_table, rel.to_column));
    }

    return used;
  }

  private collectVisualMeasures(nodes: LineageNode[], edges: LineageEdge[]): Set<string> {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const used = new Set<string>();

    for (const edge of edges) {
      if (edge.type !== 'uses_field') continue;
      const toNode = nodeMap.get(edge.to);
      if (!toNode || toNode.type !== 'measure') continue;

      const table = ((toNode.metadata?.['table'] as string | undefined) || '').trim();
      if (table) {
        used.add(this.makeKey(table, toNode.name));
      }
    }

    return used;
  }

  private collectVisualColumns(nodes: LineageNode[], edges: LineageEdge[]): Set<string> {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const used = new Set<string>();

    for (const edge of edges) {
      if (edge.type !== 'uses_field') continue;
      const toNode = nodeMap.get(edge.to);
      if (!toNode || toNode.type !== 'column') continue;

      const table = ((toNode.metadata?.['table'] as string | undefined) || '').trim();
      if (table) {
        used.add(this.makeKey(table, toNode.name));
      }
    }

    return used;
  }

  private collectDependencyMeasures(nodes: LineageNode[], edges: LineageEdge[]): Set<string> {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const used = new Set<string>();

    for (const edge of edges) {
      if (edge.type !== 'depends_on_measure') continue;
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);

      if (fromNode?.type === 'measure') {
        const table = ((fromNode.metadata?.['table'] as string | undefined) || '').trim();
        if (table) used.add(this.makeKey(table, fromNode.name));
      }

      if (toNode?.type === 'measure') {
        const table = ((toNode.metadata?.['table'] as string | undefined) || '').trim();
        if (table) used.add(this.makeKey(table, toNode.name));
      }
    }

    return used;
  }

  private buildColumnMetadataMap(nodes: LineageNode[]): Map<string, Record<string, any>> {
    const map = new Map<string, Record<string, any>>();
    for (const node of nodes) {
      if (node.type !== 'column') continue;
      const table = ((node.metadata?.['table'] as string | undefined) || '').trim();
      if (!table) continue;
      map.set(this.makeKey(table, node.name), node.metadata || {});
    }
    return map;
  }

  private collectDaxActivatedRelationships(allMeasures: TableMeasureRef[]): Set<string> {
    const relationKeys = new Set<string>();
    const relationshipCallRegex = /USERELATIONSHIP\s*\(([^)]*)\)/gi;
    const columnRefRegex = /(?:'([^']+)'|([A-Za-z0-9_]+))\s*\[\s*([^\]]+)\s*\]/g;

    for (const ref of allMeasures) {
      const expression = ref.measure.expression || '';
      if (!expression) continue;

      let callMatch: RegExpExecArray | null;
      while ((callMatch = relationshipCallRegex.exec(expression)) !== null) {
        const innerArgs = callMatch[1] || '';
        const endpoints: Array<{ table: string; column: string }> = [];
        let colMatch: RegExpExecArray | null;

        while ((colMatch = columnRefRegex.exec(innerArgs)) !== null) {
          const table = (colMatch[1] || colMatch[2] || '').trim();
          const column = (colMatch[3] || '').trim();
          if (table && column) endpoints.push({ table, column });
        }

        if (endpoints.length >= 2) {
          relationKeys.add(
            this.normalizeRelationshipKey(
              endpoints[0].table,
              endpoints[0].column,
              endpoints[1].table,
              endpoints[1].column,
            ),
          );
        }
      }
    }

    return relationKeys;
  }

  private normalizeRelationshipKey(fromTable: string, fromColumn: string, toTable: string, toColumn: string): string {
    const a = this.makeKey(fromTable, fromColumn);
    const b = this.makeKey(toTable, toColumn);
    return [a, b].sort().join('<->');
  }

  private resolveMeasureUsageStatus(
    key: string,
    visualMeasures: Set<string>,
    dependencyMeasures: Set<string>,
  ): UsageStatus {
    if (visualMeasures.has(key)) return 'used';
    if (dependencyMeasures.has(key)) return 'dependency-only';
    return 'unused';
  }

  private isLikelyLargeTextColumn(column: CatalogColumn): boolean {
    const dataType = (column.data_type || '').toLowerCase();
    const textLike = /(string|text|varchar|char)/i.test(dataType);
    const nameLikeLargeText = this.largeTextNamePattern.test(column.name || '');
    return textLike && nameLikeLargeText;
  }

  private isNumericDataType(dataType: string): boolean {
    return /(int|decimal|double|number|currency|numeric|whole|fixed)/i.test(dataType || '');
  }

  private isPotentialCalculatedColumn(column: CatalogColumn, metadata?: Record<string, any>): boolean {
    const metadataHint = Boolean(metadata?.['is_calculated'] || metadata?.['expression'] || metadata?.['dax_expression']);
    const missingSource = !(column.source_column || '').trim();
    const namingHint = this.calcColumnNamePattern.test(column.name || '');
    return metadataHint || (missingSource && namingHint);
  }

  private makeKey(tableName: string, objectName: string): string {
    return `${(tableName || '').trim().toLowerCase()}::${(objectName || '').trim().toLowerCase()}`;
  }

  get filteredFindings(): OptimizationFinding[] {
    const check = this.checkFilter.value;
    const type = this.typeFilter.value;
    const severity = this.severityFilter.value;
    const safe = this.safeOnlyFilter.value;
    const table = this.tableFilter.value;
    const usage = this.usageStatusFilter.value;
    const visibility = this.visibilityFilter.value;
    const search = this.searchFilter.value.trim().toLowerCase();

    return this.findings.filter((finding) => {
      const matchesCheck = check === 'all' || String(finding.checkId) === check;
      const matchesType = type === 'all' || finding.objectType === type;
      const matchesSeverity = severity === 'all' || finding.severity === severity;
      const matchesSafe = safe === 'all' || (safe === 'safe' ? finding.safeToRemove : !finding.safeToRemove);
      const matchesTable = table === 'all' || finding.tableName === table;
      const matchesUsage = usage === 'all' || finding.usageStatus === usage;
      const matchesVisibility = visibility === 'all' || finding.visibility === visibility;
      const matchesSearch =
        !search ||
        [finding.objectName, finding.tableName, finding.reason, finding.recommendation, finding.checkLabel, finding.usageStatus]
          .join(' ')
          .toLowerCase()
          .includes(search);

      return matchesCheck && matchesType && matchesSeverity && matchesSafe && matchesTable && matchesUsage && matchesVisibility && matchesSearch;
    });
  }

  get pagedFindings(): OptimizationFinding[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredFindings.slice(start, start + this.pageSize);
  }

  get pageNumbers(): number[] {
    const count = Math.ceil(this.filteredFindings.length / this.pageSize);
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  get visiblePageItems(): Array<number | '...'> {
    const total = this.pageNumbers.length;
    if (total <= 9) {
      return this.pageNumbers;
    }

    let start = this.currentPage - 1;
    let end = this.currentPage + 1;

    if (this.currentPage <= 4) {
      start = 2;
      end = 5;
    }

    if (this.currentPage >= total - 3) {
      start = total - 4;
      end = total - 1;
    }

    start = Math.max(2, start);
    end = Math.min(total - 1, end);

    const items: Array<number | '...'> = [1];

    if (start > 2) {
      items.push('...');
    }

    for (let i = start; i <= end; i += 1) {
      items.push(i);
    }

    if (end < total - 1) {
      items.push('...');
    }

    items.push(total);
    return items;
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.pageNumbers.length) return;
    this.currentPage = page;
  }

  applyCheckFilter(checkId: number): void {
    this.checkFilter.setValue(String(checkId));
    this.typeFilter.setValue('all');
    this.severityFilter.setValue('all');
    this.safeOnlyFilter.setValue('all');
    this.tableFilter.setValue('all');
    this.usageStatusFilter.setValue('all');
    this.visibilityFilter.setValue('all');
    this.searchFilter.setValue('');
    this.currentPage = 1;
    this.scrollTo('optimization-findings');
  }

  isCheckActive(checkId: number): boolean {
    return this.checkFilter.value === `${checkId}`;
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  get checkCards(): Array<{ id: number; label: string; count: number; severityTone: 'error' | 'warning' | 'info' }> {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return ids.map((id) => ({
      id,
      label: this.checkLabelById(id),
      count: this.findings.filter((f) => f.checkId === id).length,
      severityTone: this.checkSeverityTone(id),
    }));
  }

  get tableOptions(): string[] {
    return Array.from(new Set(this.findings.map((f) => f.tableName))).sort((a, b) => a.localeCompare(b));
  }

  get severitySummary(): Array<{ label: FindingSeverity; count: number }> {
    return [
      { label: 'High', count: this.findings.filter((f) => f.severity === 'High').length },
      { label: 'Medium', count: this.findings.filter((f) => f.severity === 'Medium').length },
      { label: 'Low', count: this.findings.filter((f) => f.severity === 'Low').length },
    ];
  }

  statusTone(status?: string): 'error' | 'warning' | 'info' | 'success' {
    const value = (status || '').toLowerCase();
    if (value === 'error') return 'error';
    if (value === 'ready') return 'success';
    if (value === 'analyzing' || value === 'pending') return 'warning';
    return 'info';
  }

  severityClass(severity: FindingSeverity): string {
    return `sev-${severity.toLowerCase()}`;
  }

  confidenceClass(confidence: FindingConfidence): string {
    return `conf-${confidence.toLowerCase()}`;
  }

  usageStatusClass(status: UsageStatus): string {
    return `usage-${status}`;
  }

  checkTooltip(checkId: number): string {
    return this.checkHelpById(checkId);
  }

  objectTooltip(row: OptimizationFinding): string {
    return `${row.objectType} • ${row.tableName}.${row.objectName}\nUsage: ${row.usageStatus}\nVisibility: ${row.visibility}`;
  }

  checkSeverityTone(checkId: number): 'error' | 'warning' | 'info' {
    switch (checkId) {
      case 1:
      case 2:
      case 3:
        return 'error';
      case 4:
      case 5:
      case 9:
      case 10:
        return 'warning';
      default:
        return 'info';
    }
  }

  private checkLabelById(id: number): string {
    switch (id) {
      case 1:
        return 'Unused Columns';
      case 2:
        return 'Unused Measures';
      case 3:
        return 'Unused Tables';
      case 4:
        return 'Bi-Directional Relationships May Be Unnecessary';
      case 5:
        return 'Inactive Relationships Never Activated In DAX';
      case 6:
        return 'Hidden Measures Not Used In Visuals';
      case 7:
        return 'Visible Technical Columns';
      case 8:
        return 'Measures Without Format String';
      case 9:
        return 'Large Text Columns Not Used In Visuals';
      case 10:
        return 'Calculated Columns That Could Be Measures';
      default:
        return `Check ${id}`;
    }
  }

  private checkHelpById(id: number): string {
    switch (id) {
      case 1:
        return 'Flags columns with no lineage usage in visuals, measure references, or relationships.';
      case 2:
        return 'Flags measures not used by visuals and not referenced by other measures.';
      case 3:
        return 'Flags tables with no used columns/measures and no relationship participation.';
      case 4:
        return 'Flags relationships configured with bi-directional cross-filtering (Both).';
      case 5:
        return 'Flags inactive relationships where USERELATIONSHIP activation is not found in DAX.';
      case 6:
        return 'Flags hidden measures not directly consumed by visuals.';
      case 7:
        return 'Flags visible key-like technical columns (id, fk_, pk_, _guid, etc.).';
      case 8:
        return 'Flags measures with missing format string definitions.';
      case 9:
        return 'Flags text-like descriptive columns that do not appear in visual bindings.';
      case 10:
        return 'Flags likely calculated numeric columns that may be better modeled as measures.';
      default:
        return 'No additional help available for this check.';
    }
  }
}
