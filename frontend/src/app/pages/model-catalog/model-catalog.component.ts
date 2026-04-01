import { Component } from '@angular/core';
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
import { CatalogService } from '../../services/catalog.service';
import { ProjectService } from '../../services/project.service';
import {
  CatalogMeasure,
  CatalogRelationship,
  CatalogResponse,
  CatalogRole,
  CatalogTable,
  Project,
} from '../../shared/models/api.models';
import { SeverityBadgeComponent } from '../../shared/components/severity-badge/severity-badge.component';

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
  ],
  templateUrl: './model-catalog.component.html',
  styleUrl: './model-catalog.component.scss'
})
export class ModelCatalogComponent {
  projectId: number;
  project: Project | null = null;
  catalog: CatalogResponse | null = null;

  // Tables section
  readonly tableSearch = new FormControl('', { nonNullable: true });
  readonly tableMode = new FormControl('all', { nonNullable: true });
  readonly tableMeasureFilter = new FormControl('', { nonNullable: true });
  readonly showHiddenTables = new FormControl(true, { nonNullable: true });
  filteredTableMeasures: string[] = [];
  tableCurrentPage = 1;
  tablePageSize = 7;

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

  readonly measureColumns = ['name', 'table_name', 'display_folder', 'format_string', 'is_hidden'];
  readonly relationshipColumns = ['from', 'to', 'cardinality', 'cross_filter', 'is_active'];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly catalogService: CatalogService,
    private readonly projectService: ProjectService,
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

    return this.catalog.tables.filter((table) => {
      const matchesSearch = !search || table.name.toLowerCase().includes(search);
      const matchesMode = mode === 'all' || table.mode === mode;
      const matchesHidden = showHidden || !table.is_hidden;
      const matchesMeasure = !measureFilter || (table.measures || []).some((m) => m.name === measureFilter);
      return matchesSearch && matchesMode && matchesHidden && matchesMeasure;
    });
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

  get measureTables(): string[] {
    return Array.from(new Set(this.allMeasures.map((m) => m.table_name ?? ''))).filter(Boolean);
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
    if (!this.catalog) return 0;
    return this.catalog.tables.reduce((sum, table) => sum + (table.partition_count || 0), 0);
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

}
