import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
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

interface OptimizationFinding {
  checkId: number;
  checkLabel: string;
  objectType: FindingType;
  objectName: string;
  tableName: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  reason: string;
  recommendation: string;
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
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
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

  currentPage = 1;
  readonly pageSize = 10;

  private readonly technicalColumnPattern = /(^id$|_id$|^id_|_key$|_code$|_guid$|^fk_|^pk_)/i;

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
    const visualMeasures = this.collectVisualMeasures(nodes, edges);
    const dependencyMeasures = this.collectDependencyMeasures(nodes, edges);

    const usedMeasures = new Set<string>([...visualMeasures, ...dependencyMeasures]);

    const tableByName = new Map(catalog.tables.map((t) => [t.name.toLowerCase(), t]));
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
          reason: 'No visual, measure, or relationship usage was detected.',
          recommendation: 'Review and remove this column or hide it if kept for compatibility.',
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
          reason: 'No report visual or measure dependency references were found.',
          recommendation: 'Remove the measure or move it to an archive table if it is not needed.',
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
          reason: 'No active lineage or relationship references were found for this table.',
          recommendation: 'Consider removing the table or excluding it from refresh.',
          safeToRemove: true,
        });
      }
    }

    // 4. Bi-directional relationships
    for (const rel of catalog.relationships) {
      if ((rel.cross_filter || '').toLowerCase().includes('both')) {
        findings.push({
          checkId: 4,
          checkLabel: 'Bi-Directional Relationships',
          objectType: 'Relationship',
          objectName: `${rel.from_table}.${rel.from_column} -> ${rel.to_table}.${rel.to_column}`,
          tableName: rel.from_table,
          severity: 'Medium',
          confidence: 'High',
          reason: 'Bi-directional cross filtering can increase ambiguity and query cost.',
          recommendation: 'Review whether single-direction filtering can satisfy the report behavior.',
          safeToRemove: false,
        });
      }
    }

    // 5. Inactive relationships
    for (const rel of catalog.relationships) {
      if (!rel.is_active) {
        findings.push({
          checkId: 5,
          checkLabel: 'Inactive Relationships',
          objectType: 'Relationship',
          objectName: `${rel.from_table}.${rel.from_column} -> ${rel.to_table}.${rel.to_column}`,
          tableName: rel.from_table,
          severity: 'Medium',
          confidence: 'High',
          reason: 'Inactive relationships are often legacy paths or alternate modeling branches.',
          recommendation: 'Validate if this relationship is still needed and remove unused ones.',
          safeToRemove: false,
        });
      }
    }

    // 7. Hidden measures never used in visuals
    for (const ref of allMeasures) {
      const key = this.makeKey(ref.table.name, ref.measure.name);
      if (ref.measure.is_hidden && !visualMeasures.has(key)) {
        findings.push({
          checkId: 7,
          checkLabel: 'Hidden Measures Not Used In Visuals',
          objectType: 'Measure',
          objectName: ref.measure.name,
          tableName: ref.table.name,
          severity: 'Low',
          confidence: dependencyOnlyMeasures.has(key) ? 'Medium' : 'High',
          reason: dependencyOnlyMeasures.has(key)
            ? 'Hidden measure is not used in visuals and appears only in measure dependencies.'
            : 'Hidden measure is not used by visuals or downstream calculations.',
          recommendation: dependencyOnlyMeasures.has(key)
            ? 'Keep if part of a reusable measure chain, otherwise consolidate and remove.'
            : 'Remove or merge it with other calculations if no longer needed.',
          safeToRemove: !dependencyOnlyMeasures.has(key),
        });
      }
    }

    // 8. Visible technical columns
    for (const ref of allColumns) {
      if (!ref.column.is_hidden && this.technicalColumnPattern.test(ref.column.name)) {
        findings.push({
          checkId: 8,
          checkLabel: 'Visible Technical Columns',
          objectType: 'Column',
          objectName: ref.column.name,
          tableName: ref.table.name,
          severity: 'Low',
          confidence: 'Medium',
          reason: 'Technical key-like columns are visible to report authors/users.',
          recommendation: 'Hide technical columns that are not intended for report consumption.',
          safeToRemove: false,
        });
      }
    }

    // 9. Measures without format string
    for (const ref of allMeasures) {
      if (!(ref.measure.format_string || '').trim()) {
        findings.push({
          checkId: 9,
          checkLabel: 'Measures Without Format String',
          objectType: 'Measure',
          objectName: ref.measure.name,
          tableName: ref.table.name,
          severity: 'Low',
          confidence: 'High',
          reason: 'No explicit measure formatting is defined.',
          recommendation: 'Set a consistent format string to improve report readability and avoid implicit formatting.',
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

  private makeKey(tableName: string, objectName: string): string {
    return `${(tableName || '').trim().toLowerCase()}::${(objectName || '').trim().toLowerCase()}`;
  }

  get filteredFindings(): OptimizationFinding[] {
    const check = this.checkFilter.value;
    const type = this.typeFilter.value;
    const severity = this.severityFilter.value;
    const safe = this.safeOnlyFilter.value;
    const search = this.searchFilter.value.trim().toLowerCase();

    return this.findings.filter((finding) => {
      const matchesCheck = check === 'all' || String(finding.checkId) === check;
      const matchesType = type === 'all' || finding.objectType === type;
      const matchesSeverity = severity === 'all' || finding.severity === severity;
      const matchesSafe = safe === 'all' || (safe === 'safe' ? finding.safeToRemove : !finding.safeToRemove);
      const matchesSearch =
        !search ||
        [finding.objectName, finding.tableName, finding.reason, finding.recommendation, finding.checkLabel]
          .join(' ')
          .toLowerCase()
          .includes(search);

      return matchesCheck && matchesType && matchesSeverity && matchesSafe && matchesSearch;
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

  get checkCards(): Array<{ id: number; label: string; count: number }> {
    const ids = [1, 2, 3, 4, 5, 7, 8, 9];
    return ids.map((id) => ({
      id,
      label: this.checkLabelById(id),
      count: this.findings.filter((f) => f.checkId === id).length,
    }));
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

  private checkLabelById(id: number): string {
    switch (id) {
      case 1:
        return 'Unused Columns';
      case 2:
        return 'Unused Measures';
      case 3:
        return 'Unused Tables';
      case 4:
        return 'Bi-Directional Relationships';
      case 5:
        return 'Inactive Relationships';
      case 7:
        return 'Hidden Measures Not Used In Visuals';
      case 8:
        return 'Visible Technical Columns';
      case 9:
        return 'Measures Without Format String';
      default:
        return `Check ${id}`;
    }
  }
}
