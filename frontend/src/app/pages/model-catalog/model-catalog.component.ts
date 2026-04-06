import { Component, ElementRef, ViewChild, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { RouterLink } from '@angular/router';
import { forkJoin, timeout } from 'rxjs';
import { CatalogService } from '../../services/catalog.service';
import { ProjectService } from '../../services/project.service';
import { LineageService, LineageNode, LineageEdge } from '../../services/lineage.service';
import {
  CatalogMeasure,
  CatalogRelationship,
  CatalogResponse,
  CatalogRole,
  CatalogTable,
  PartitionImportRow,
  Project,
} from '../../shared/models/api.models';
import { SeverityBadgeComponent } from '../../shared/components/severity-badge/severity-badge.component';
import { LineageRendererComponent } from '../../shared/components/lineage-renderer/lineage-renderer.component';

interface MeasureInsight {
  columns: string[];
  visuals: string[];
  dependsOnMeasures: string[];
  usedByMeasures: string[];
}

type MeasureRelationType = 'columns' | 'visuals' | 'dependsOnMeasures' | 'usedByMeasures';

@Component({
  selector: 'app-model-catalog',
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    MatTabsModule,
    MatAutocompleteModule,
    SeverityBadgeComponent,
    LineageRendererComponent,
  ],
  templateUrl: './model-catalog.component.html',
  styleUrl: './model-catalog.component.scss'
})
export class ModelCatalogComponent implements OnInit {
  private readonly defaultLineageZoom = 1.2;

  projectId: number;
  project: Project | null = null;
  catalog: CatalogResponse | null = null;

  // Lineage properties
  @ViewChild('lineageContainer') lineageContainer!: ElementRef;
  lineageMode: 'full' | 'visual' | 'impact' | 'column' = 'full';
  lineageNodes: LineageNode[] = [];
  lineageEdges: LineageEdge[] = [];
  lineageLoading = false;
  lineageVisuals: Array<{ page: string; name: string }> = [];
  lineageMeasures: string[] = [];
  lineageTables: string[] = [];
  lineageColumns: string[] = [];
  selectedVisual: { page: string; name: string } | null = null;
  selectedMeasure: string | null = null;
  selectedLineageTable: string | null = null;
  selectedColumn: string | null = null;
  lineageZoom = this.defaultLineageZoom;
  lineageRecenterToken = 0;
  lineageSelectorsLoaded = false;
  lineageFullscreen = false;

  // Tables section
  readonly tableSearch = new FormControl('', { nonNullable: true });
  readonly tableMode = new FormControl('all', { nonNullable: true });
  readonly tableMeasureFilter = new FormControl('', { nonNullable: true });
  readonly tableSort = new FormControl('name_asc', { nonNullable: true });
  readonly showHiddenTables = new FormControl(true, { nonNullable: true });
  filteredTableMeasures: string[] = [];
  tableCurrentPage = 1;
  tablePageSize = 5;

  // Expand states for columns and measures
  expandedTableId: number | null = null;
  expandedItemType: 'columns' | 'measures' | null = null;

  // Measures section
  readonly measureSearch = new FormControl('', { nonNullable: true });
  readonly measureTable = new FormControl('all', { nonNullable: true });
  readonly measureFolder = new FormControl('all', { nonNullable: true });

  // Relationships section
  readonly relationshipSearch = new FormControl('', { nonNullable: true });
  readonly relationshipActive = new FormControl('all', { nonNullable: true });
  relationshipCurrentPage = 1;
  readonly relationshipPageSize = 10;
  readonly partitionSearch = new FormControl('', { nonNullable: true });
  readonly partitionSource = new FormControl('all', { nonNullable: true });
  readonly partitionProject = new FormControl('all', { nonNullable: true });

  partitionRows: PartitionImportRow[] = [];
  partitionsLoading = false;
  partitionCurrentPage = 1;
  readonly partitionPageSize = 7;
  mQueryModalOpen = false;
  mQueryModalTitle = '';
  mQueryModalContent = '';

  readonly measureColumns = ['name', 'table_name', 'display_folder', 'format_string', 'is_hidden'];
  readonly relationshipColumns = ['from', 'to', 'cardinality', 'cross_filter', 'is_active'];
  measureInsightsLoading = false;
  private measureInsights: Record<string, MeasureInsight> = {};
  private expandedFormulaMeasureKeys = new Set<string>();
  private expandedMeasureRelationKeys = new Set<string>();
  measureCurrentPage = 1;
  readonly measurePageSize = 10;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly catalogService: CatalogService,
    private readonly projectService: ProjectService,
    private readonly lineageService: LineageService,
  ) {
    this.projectId = Number(this.route.snapshot.paramMap.get('id'));
    this.projectService.getById(this.projectId).subscribe((project) => {
      this.project = project;
    });
    this.catalogService.getCatalog(this.projectId).subscribe((catalog) => {
      this.catalog = catalog;
      this.filteredTableMeasures = this.allTableMeasures;
    });
    this.tableMeasureFilter.valueChanges.subscribe((value) => {
      this.filterTableMeasures(value);
    });
    this.tableSearch.valueChanges.subscribe(() => {
      this.tableCurrentPage = 1;
    });
    this.tableMode.valueChanges.subscribe(() => {
      this.tableCurrentPage = 1;
    });
    this.tableMeasureFilter.valueChanges.subscribe(() => {
      this.tableCurrentPage = 1;
    });
    this.showHiddenTables.valueChanges.subscribe(() => {
      this.tableCurrentPage = 1;
    });
    this.tableSort.valueChanges.subscribe(() => {
      this.tableCurrentPage = 1;
    });

    this.measureSearch.valueChanges.subscribe(() => {
      this.measureCurrentPage = 1;
    });
    this.measureTable.valueChanges.subscribe(() => {
      this.measureCurrentPage = 1;
    });
    this.measureFolder.valueChanges.subscribe(() => {
      this.measureCurrentPage = 1;
    });

    this.relationshipSearch.valueChanges.subscribe(() => {
      this.relationshipCurrentPage = 1;
    });
    this.relationshipActive.valueChanges.subscribe(() => {
      this.relationshipCurrentPage = 1;
    });

    this.partitionSearch.valueChanges.subscribe(() => {
      this.partitionCurrentPage = 1;
    });
    this.partitionSource.valueChanges.subscribe(() => {
      this.partitionCurrentPage = 1;
    });
    this.partitionProject.valueChanges.subscribe(() => {
      this.partitionCurrentPage = 1;
    });
  }

  ngOnInit(): void {
    this.initLineageData();
    this.loadFullLineage();
    this.loadPartitions();
    this.loadMeasureInsights();
  }

  filterTableMeasures(value: string): void {
    const search = value.toLowerCase().trim();
    this.filteredTableMeasures = this.allTableMeasures.filter((measure) =>
      measure.toLowerCase().includes(search)
    );
  }

  exportCatalog(): void {
    this.catalogService.exportCatalog(this.projectId).subscribe((blob) => {
      this.download(blob, `project_${this.projectId}_catalog.xlsx`);
    });
  }

  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  get filteredTables(): CatalogTable[] {
    if (!this.catalog) return [];

    const search = this.tableSearch.value.toLowerCase().trim();
    const mode = this.tableMode.value;
    const showHidden = this.showHiddenTables.value;
    const measureFilter = this.tableMeasureFilter.value;
    const sort = this.tableSort.value;

    const filtered = this.catalog.tables.filter((table) => {
      const matchesSearch = !search || table.name.toLowerCase().includes(search);
      const matchesMode = mode === 'all' || table.mode === mode;
      const matchesHidden = showHidden || !table.is_hidden;
      const matchesMeasure = !measureFilter || (table.measures || []).some((m) => m.name === measureFilter);
      return matchesSearch && matchesMode && matchesHidden && matchesMeasure;
    });

    const sorted = [...filtered];
    switch (sort) {
      case 'columns_desc':
        sorted.sort((a, b) => (b.column_count || 0) - (a.column_count || 0) || a.name.localeCompare(b.name));
        break;
      case 'columns_asc':
        sorted.sort((a, b) => (a.column_count || 0) - (b.column_count || 0) || a.name.localeCompare(b.name));
        break;
      case 'measures_desc':
        sorted.sort((a, b) => (b.measure_count || 0) - (a.measure_count || 0) || a.name.localeCompare(b.name));
        break;
      case 'measures_asc':
        sorted.sort((a, b) => (a.measure_count || 0) - (b.measure_count || 0) || a.name.localeCompare(b.name));
        break;
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return sorted;
  }

  get allMeasures(): CatalogMeasure[] {
    return this.catalog?.tables.flatMap((table) =>
      (table.measures ?? []).map((measure) => ({ ...measure, table_name: table.name }))
    ) ?? [];
  }

  get filteredMeasures(): CatalogMeasure[] {
    const search = this.measureSearch.value.toLowerCase().trim();
    const table = this.measureTable.value;
    const folder = this.measureFolder.value;

    return this.allMeasures.filter((measure) => {
      const matchesSearch = !search || measure.name.toLowerCase().includes(search);
      const matchesTable = table === 'all' || measure.table_name === table;
      const matchesFolder = folder === 'all' || (measure.display_folder ?? '') === folder;
      return matchesSearch && matchesTable && matchesFolder;
    });
  }

  get measurePageNumbers(): number[] {
    const pageCount = Math.ceil(this.filteredMeasures.length / this.measurePageSize);
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  get pagedFilteredMeasures(): CatalogMeasure[] {
    const start = (this.measureCurrentPage - 1) * this.measurePageSize;
    return this.filteredMeasures.slice(start, start + this.measurePageSize);
  }

  goToMeasurePage(page: number): void {
    if (page < 1 || page > this.measurePageNumbers.length) return;
    this.measureCurrentPage = page;
  }

  get measureTables(): string[] {
    return Array.from(new Set(this.allMeasures.map((m) => m.table_name ?? ''))).filter(Boolean);
  }

  get filteredMeasureSuggestions(): string[] {
    const query = this.measureSearch.value.toLowerCase().trim();
    const names = Array.from(new Set(this.allMeasures.map((m) => m.name))).sort((a, b) => a.localeCompare(b));
    if (!query) {
      return names.slice(0, 12);
    }
    return names.filter((name) => name.toLowerCase().includes(query)).slice(0, 12);
  }

  get measureFolders(): string[] {
    return Array.from(new Set(this.allMeasures.map((m) => m.display_folder ?? ''))).filter(Boolean);
  }

  get filteredRelationships(): CatalogRelationship[] {
    if (!this.catalog) return [];

    const search = this.relationshipSearch.value.toLowerCase().trim();
    const active = this.relationshipActive.value;

    return this.catalog.relationships.filter((relationship) => {
      const matchesSearch =
        !search ||
        relationship.from_table.toLowerCase().includes(search) ||
        relationship.to_table.toLowerCase().includes(search);

      const matchesActive =
        active === 'all' ||
        (active === 'active' && relationship.is_active) ||
        (active === 'inactive' && !relationship.is_active);

      return matchesSearch && matchesActive;
    });
  }

  get relationshipPageNumbers(): number[] {
    const pageCount = Math.ceil(this.filteredRelationships.length / this.relationshipPageSize);
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  get pagedFilteredRelationships(): CatalogRelationship[] {
    const start = (this.relationshipCurrentPage - 1) * this.relationshipPageSize;
    return this.filteredRelationships.slice(start, start + this.relationshipPageSize);
  }

  goToRelationshipPage(page: number): void {
    if (page < 1 || page > this.relationshipPageNumbers.length) {
      return;
    }
    this.relationshipCurrentPage = page;
  }

  statusTone(status?: string): 'error' | 'warning' | 'info' | 'success' {
    if (status === 'ready') return 'success';
    if (status === 'error') return 'error';
    if (status === 'analyzing') return 'warning';
    return 'info';
  }

  get roles(): CatalogRole[] {
    return this.catalog?.roles ?? [];
  }

  get tablePageNumbers(): number[] {
    const pages = Math.ceil(this.filteredTables.length / this.tablePageSize);
    return Array.from({ length: pages }, (_, i) => i + 1);
  }

  get tablePaginatedTables(): CatalogTable[] {
    const start = (this.tableCurrentPage - 1) * this.tablePageSize;
    return this.filteredTables.slice(start, start + this.tablePageSize);
  }

  goToTablePage(page: number): void {
    if (page >= 1 && page <= this.tablePageNumbers.length) {
      this.tableCurrentPage = page;
    }
  }

  get totalPartitions(): number {
    return this.partitionRows.length;
  }

  get partitionSources(): string[] {
    return Array.from(
      new Set(
        this.partitionRows
          .map((row) => (row.source || '').trim())
          .filter((value) => !!value && value !== '—' && value.toLowerCase() !== 'unknown')
      )
    ).sort((a, b) => a.localeCompare(b));
  }

  get partitionProjects(): string[] {
    return Array.from(
      new Set(
        this.partitionRows
          .map((row) => (row.sourceProject || row.bqProject || '').trim())
          .filter((value) => !!value && value !== '—')
      )
    ).sort((a, b) => a.localeCompare(b));
  }

  get filteredPartitionRows(): PartitionImportRow[] {
    const search = this.partitionSearch.value.toLowerCase().trim();
    const source = this.partitionSource.value;
    const project = this.partitionProject.value;

    const rows = this.partitionRows.filter((row) => {
      const isImport = (row.mode || '').toLowerCase() === 'import' || !row.mode;
      const matchesSource = source === 'all' || (row.source || '') === source;
      const matchesProject = project === 'all' || ((row.sourceProject || row.bqProject || '') === project);
      return isImport && matchesSource && matchesProject;
    });

    if (!search) {
      return rows;
    }

    return rows.filter((row) => {
      return [
        row.table,
        row.source,
        row.sourceProject,
        row.sourceDataset,
        row.sourceObject,
        row.bqProject,
        row.bqDataset,
        row.bqTable,
        row.sqlQuery,
        row.mTransformations,
        row.fullMQuery,
      ]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  }

  get pagedPartitionRows(): PartitionImportRow[] {
    const start = (this.partitionCurrentPage - 1) * this.partitionPageSize;
    return this.filteredPartitionRows.slice(start, start + this.partitionPageSize);
  }

  get partitionPageNumbers(): number[] {
    const pageCount = Math.ceil(this.filteredPartitionRows.length / this.partitionPageSize);
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  goToPartitionPage(page: number): void {
    if (page < 1 || page > this.partitionPageNumbers.length) {
      return;
    }
    this.partitionCurrentPage = page;
  }

  get allTableMeasures(): string[] {
    if (!this.catalog) return [];
    const measures = new Set<string>();
    this.catalog.tables.forEach((table) => {
      (table.measures || []).forEach((measure) => {
        measures.add(measure.name);
      });
    });
    return Array.from(measures).sort();
  }

  measureKey(measure: CatalogMeasure): string {
    return `${measure.table_name || 'unknown'}::${measure.name}`;
  }

  getMeasureInsight(measure: CatalogMeasure): MeasureInsight {
    const key = this.measureKey(measure);
    return this.measureInsights[key] || {
      columns: [],
      visuals: [],
      dependsOnMeasures: [],
      usedByMeasures: [],
    };
  }

  formulaText(measure: CatalogMeasure): string {
    return (measure.expression || '').trim() || '—';
  }

  displayedFormatString(measure: CatalogMeasure): string {
    const value = (measure.format_string || '').trim();
    return value || '—';
  }

  isFormulaLong(measure: CatalogMeasure): boolean {
    return this.formulaText(measure).length > 280;
  }

  isFormulaExpanded(measure: CatalogMeasure): boolean {
    return this.expandedFormulaMeasureKeys.has(this.measureKey(measure));
  }

  toggleFormulaExpanded(measure: CatalogMeasure): void {
    const key = this.measureKey(measure);
    if (this.expandedFormulaMeasureKeys.has(key)) {
      this.expandedFormulaMeasureKeys.delete(key);
      return;
    }
    this.expandedFormulaMeasureKeys.add(key);
  }

  displayedFormulaText(measure: CatalogMeasure): string {
    const value = this.formulaText(measure);
    if (value === '—') return value;
    if (this.isFormulaExpanded(measure) || value.length <= 280) return value;
    return `${value.slice(0, 280)}...`;
  }

  copyMeasureFormula(measure: CatalogMeasure): void {
    const value = this.formulaText(measure);
    if (value === '—') return;
    navigator.clipboard?.writeText(value).catch(() => undefined);
  }

  private relationKey(measure: CatalogMeasure, type: MeasureRelationType): string {
    return `${this.measureKey(measure)}::${type}`;
  }

  isMeasureRelationExpanded(measure: CatalogMeasure, type: MeasureRelationType): boolean {
    return this.expandedMeasureRelationKeys.has(this.relationKey(measure, type));
  }

  toggleMeasureRelationExpanded(measure: CatalogMeasure, type: MeasureRelationType): void {
    const key = this.relationKey(measure, type);
    if (this.expandedMeasureRelationKeys.has(key)) {
      this.expandedMeasureRelationKeys.delete(key);
      return;
    }
    this.expandedMeasureRelationKeys.add(key);
  }

  relationItems(measure: CatalogMeasure, type: MeasureRelationType): string[] {
    const insight = this.getMeasureInsight(measure);
    return insight[type] || [];
  }

  visibleRelationItems(measure: CatalogMeasure, type: MeasureRelationType): string[] {
    const items = this.relationItems(measure, type);
    if (this.isMeasureRelationExpanded(measure, type)) return items;
    return items.slice(0, 4);
  }

  hasMoreRelationItems(measure: CatalogMeasure, type: MeasureRelationType): boolean {
    return this.relationItems(measure, type).length > 4;
  }

  private loadMeasureInsights(): void {
    this.measureInsightsLoading = true;
    this.lineageService.getFullLineage(this.projectId).pipe(timeout(15000)).subscribe({
      next: ({ nodes, edges }) => {
        this.measureInsights = this.buildMeasureInsights(nodes, edges);
        this.measureInsightsLoading = false;
      },
      error: () => {
        this.measureInsightsLoading = false;
      },
    });
  }

  private buildMeasureInsights(nodes: LineageNode[], edges: LineageEdge[]): Record<string, MeasureInsight> {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const result: Record<string, MeasureInsight> = {};

    const ensure = (measureId: string): MeasureInsight => {
      const measureNode = nodeById.get(measureId);
      const table = (measureNode?.metadata?.['table'] as string | undefined) || 'unknown';
      const key = `${table}::${measureNode?.name || measureId}`;
      if (!result[key]) {
        result[key] = {
          columns: [],
          visuals: [],
          dependsOnMeasures: [],
          usedByMeasures: [],
        };
      }
      return result[key];
    };

    for (const edge of edges) {
      const fromNode = nodeById.get(edge.from);
      const toNode = nodeById.get(edge.to);

      if (edge.type === 'references_column' && fromNode?.type === 'measure' && toNode?.type === 'column') {
        const insight = ensure(fromNode.id);
        const table = (toNode.metadata?.['table'] as string | undefined) || '';
        const label = table ? `${table}.${toNode.name}` : toNode.name;
        if (!insight.columns.includes(label)) insight.columns.push(label);
      }

      if (edge.type === 'uses_field' && fromNode?.type === 'visual' && toNode?.type === 'measure') {
        const insight = ensure(toNode.id);
        const page = (fromNode.metadata?.['page'] as string | undefined) || '';
        const visualLabel = page ? `${fromNode.name} • ${page}` : fromNode.name;
        if (!insight.visuals.includes(visualLabel)) insight.visuals.push(visualLabel);
      }

      if (edge.type === 'depends_on_measure' && fromNode?.type === 'measure' && toNode?.type === 'measure') {
        const fromInsight = ensure(fromNode.id);
        const toInsight = ensure(toNode.id);

        if (!fromInsight.dependsOnMeasures.includes(toNode.name)) {
          fromInsight.dependsOnMeasures.push(toNode.name);
        }
        if (!toInsight.usedByMeasures.includes(fromNode.name)) {
          toInsight.usedByMeasures.push(fromNode.name);
        }
      }
    }

    Object.values(result).forEach((insight) => {
      insight.columns.sort((a, b) => a.localeCompare(b));
      insight.visuals.sort((a, b) => a.localeCompare(b));
      insight.dependsOnMeasures.sort((a, b) => a.localeCompare(b));
      insight.usedByMeasures.sort((a, b) => a.localeCompare(b));
    });

    return result;
  }

  loadPartitions(): void {
    this.partitionsLoading = true;
    this.lineageService.getPartitions(this.projectId).pipe(timeout(15000)).subscribe({
      next: (rows) => {
        this.partitionRows = [...rows].sort((a, b) => a.table.localeCompare(b.table));
        this.partitionCurrentPage = 1;
        this.partitionsLoading = false;
      },
      error: () => {
        this.partitionsLoading = false;
      },
    });
  }

  partitionSourceClass(row: PartitionImportRow): string {
    const source = (row.source || '').toLowerCase();
    if (source.includes('bigquery')) return 'source-bq';
    if (source.includes('calculated')) return 'source-calculated';
    if (source.includes('sql')) return 'source-sql';
    if (source.includes('unknown') || source === '—' || !source) return 'source-unknown';
    return 'source-default';
  }

  hasRenderableMQuery(value?: string): boolean {
    if (!value) return false;
    const cleaned = value.trim();
    return cleaned !== '' && cleaned !== '—' && cleaned !== '-';
  }

  mQueryPreview(value: string, max = 180): string {
    const text = (value || '').trim();
    if (!text) return '—';
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...`;
  }

  openMQueryModal(row: PartitionImportRow): void {
    const full = (row.fullMQuery || '').trim();
    if (!this.hasRenderableMQuery(full)) return;

    this.mQueryModalTitle = `${row.table} • ${row.partitionName || 'Partition'}`;
    this.mQueryModalContent = full;
    this.mQueryModalOpen = true;
  }

  closeMQueryModal(): void {
    this.mQueryModalOpen = false;
    this.mQueryModalTitle = '';
    this.mQueryModalContent = '';
  }

  copyMQueryModalContent(): void {
    if (!this.mQueryModalContent) return;
    navigator.clipboard?.writeText(this.mQueryModalContent).catch(() => undefined);
  }

  toggleExpanded(tableId: number, type: 'columns' | 'measures'): void {
    if (this.expandedTableId === tableId && this.expandedItemType === type) {
      this.expandedTableId = null;
      this.expandedItemType = null;
    } else {
      this.expandedTableId = tableId;
      this.expandedItemType = type;
    }
  }

  isExpanded(tableId: number, type: 'columns' | 'measures'): boolean {
    return this.expandedTableId === tableId && this.expandedItemType === type;
  }

  // ── Lineage Methods ──────────────────────────────────────────

  loadFullLineage(): void {
    this.resetZoom();
    this.lineageLoading = true;
    this.lineageService.getFullLineage(this.projectId).pipe(timeout(15000)).subscribe({
      next: (data) => {
        this.lineageNodes = data.nodes;
        this.lineageEdges = data.edges;
        this.lineageLoading = false;
      },
      error: () => {
        this.lineageLoading = false;
      },
    });
  }

  loadVisualTrace(): void {
    if (!this.selectedVisual) return;
    this.resetZoom();
    this.lineageLoading = true;
    this.lineageService
      .getVisualTrace(this.projectId, this.selectedVisual.page, this.selectedVisual.name)
      .pipe(timeout(15000))
      .subscribe({
        next: (data) => {
          this.lineageNodes = data.nodes;
          this.lineageEdges = data.edges;
          this.lineageLoading = false;
        },
        error: () => {
          this.lineageLoading = false;
        },
      });
  }

  loadMeasureImpact(): void {
    if (!this.selectedMeasure) return;
    this.resetZoom();
    this.lineageLoading = true;
    this.lineageService.getMeasureImpact(this.projectId, this.selectedMeasure).pipe(timeout(15000)).subscribe({
      next: (data) => {
        this.lineageNodes = data.nodes;
        this.lineageEdges = data.edges;
        this.lineageLoading = false;
      },
      error: () => {
        this.lineageLoading = false;
      },
    });
  }

  loadColumnImpact(): void {
    if (!this.selectedLineageTable || !this.selectedColumn) return;
    this.resetZoom();
    this.lineageLoading = true;
    this.lineageService
      .getColumnImpact(this.projectId, this.selectedLineageTable, this.selectedColumn)
      .pipe(timeout(15000))
      .subscribe({
        next: (data) => {
          this.lineageNodes = data.nodes;
          this.lineageEdges = data.edges;
          this.lineageLoading = false;
        },
        error: () => {
          this.lineageLoading = false;
        },
      });
  }

  onLineageTableChange(autoLoad = false): void {
    this.selectedColumn = null;
    this.lineageColumns = [];
    if (!this.selectedLineageTable) return;
    this.lineageLoading = true;
    this.lineageService.getColumns(this.projectId, this.selectedLineageTable).pipe(timeout(15000)).subscribe({
      next: (columns: any[]) => {
        this.lineageColumns = columns.map((c: any) =>
          typeof c === 'string' ? c : c.name || String(c)
        );
        if (autoLoad && this.lineageColumns.length > 0) {
          this.selectedColumn = this.lineageColumns[0];
          this.loadColumnImpact();
          return;
        }
        this.lineageLoading = false;
      },
      error: () => {
        this.lineageLoading = false;
      },
    });
  }

  initLineageData(onReady?: () => void): void {
    if (this.lineageSelectorsLoaded) {
      onReady?.();
      return;
    }

    this.lineageLoading = true;
    forkJoin({
      visuals: this.lineageService.getVisuals(this.projectId).pipe(timeout(15000)),
      measures: this.lineageService.getMeasures(this.projectId).pipe(timeout(15000)),
      tables: this.lineageService.getTables(this.projectId).pipe(timeout(15000)),
    }).subscribe({
      next: ({ visuals, measures, tables }) => {
        this.lineageVisuals = visuals;
        this.lineageMeasures = measures.map((m: any) =>
          typeof m === 'string' ? m : m.name || String(m)
        );
        this.lineageTables = tables.map((t: any) =>
          typeof t === 'string' ? t : t.name || String(t)
        );
        this.lineageSelectorsLoaded = true;
        if (onReady) {
          onReady();
          return;
        }
        this.lineageLoading = false;
      },
      error: () => {
        this.lineageLoading = false;
      },
    });
  }

  switchLineageMode(mode: 'full' | 'visual' | 'impact' | 'column'): void {
    if (this.lineageMode !== mode) {
      this.lineageMode = mode;
      this.lineageNodes = [];
      this.lineageEdges = [];
      this.lineageLoading = false;
      this.resetZoom();
    }

    if (mode === 'full') {
      this.loadFullLineage();
      return;
    }

    if (mode === 'visual') {
      this.initLineageData(() => {
        if (!this.selectedVisual && this.lineageVisuals.length > 0) {
          this.selectedVisual = this.lineageVisuals[0];
        }
        if (this.selectedVisual) {
          this.loadVisualTrace();
          return;
        }
        this.lineageLoading = false;
      });
      return;
    }

    if (mode === 'impact') {
      this.initLineageData(() => {
        if (!this.selectedMeasure && this.lineageMeasures.length > 0) {
          this.selectedMeasure = this.lineageMeasures[0];
        }
        if (this.selectedMeasure) {
          this.loadMeasureImpact();
          return;
        }
        this.lineageLoading = false;
      });
      return;
    }

    this.initLineageData(() => {
      if (!this.selectedLineageTable && this.lineageTables.length > 0) {
        this.selectedLineageTable = this.lineageTables[0];
      }
      if (this.selectedLineageTable) {
        this.onLineageTableChange(true);
        return;
      }
      this.lineageLoading = false;
    });
  }

  zoomIn(): void {
    this.lineageZoom = Math.min(8, this.lineageZoom * 1.25);
  }

  zoomOut(): void {
    this.lineageZoom = Math.max(0.2, this.lineageZoom / 1.25);
  }

  resetZoom(): void {
    this.lineageZoom = this.defaultLineageZoom;
    this.lineageRecenterToken += 1;
  }

  toggleLineageFullscreen(): void {
    const container = this.lineageContainer?.nativeElement as HTMLElement | undefined;
    if (!container) return;

    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      msExitFullscreen?: () => Promise<void> | void;
    };
    const el = container as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      msRequestFullscreen?: () => Promise<void> | void;
    };

    const isFullscreen = !!doc.fullscreenElement;
    if (!isFullscreen) {
      if (el.requestFullscreen) {
        void el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        void el.webkitRequestFullscreen();
      } else if (el.msRequestFullscreen) {
        void el.msRequestFullscreen();
      }
      this.lineageFullscreen = true;
      return;
    }

    if (doc.exitFullscreen) {
      void doc.exitFullscreen();
    } else if (doc.webkitExitFullscreen) {
      void doc.webkitExitFullscreen();
    } else if (doc.msExitFullscreen) {
      void doc.msExitFullscreen();
    }
    this.lineageFullscreen = false;
  }

  exportLineageSvg(): void {
    const container = this.lineageContainer?.nativeElement;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    this.download(blob, `lineage_project_${this.projectId}.svg`);
  }

}
