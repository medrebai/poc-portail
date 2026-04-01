import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTableModule } from '@angular/material/table';
import { forkJoin } from 'rxjs';
import { BpaService } from '../../services/bpa.service';
import { CatalogService } from '../../services/catalog.service';
import { InspectorService } from '../../services/inspector.service';
import { ProjectService } from '../../services/project.service';
import { BpaSummary, BpaViolation, CatalogResponse, InspectorResult, Project } from '../../shared/models/api.models';
import { SeverityBadgeComponent } from '../../shared/components/severity-badge/severity-badge.component';
import { ChartCardComponent } from '../../shared/components/chart-card/chart-card.component';

@Component({
  selector: 'app-bpa-violations',
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatAutocompleteModule,
    MatTableModule,
    SeverityBadgeComponent,
    ChartCardComponent,
  ],
  templateUrl: './bpa-violations.component.html',
  styleUrl: './bpa-violations.component.scss'
})
export class BpaViolationsComponent {
  readonly projectId: number;
  project: Project | null = null;
  catalog: CatalogResponse | null = null;
  inspectorResults: InspectorResult[] = [];
  violations: BpaViolation[] = [];
  summary: BpaSummary[] = [];

  // Filter dropdowns
  readonly severityFilter = new FormControl('all', { nonNullable: true });
  readonly categoryFilter = new FormControl('all', { nonNullable: true });
  readonly objectFilter = new FormControl('', { nonNullable: true });
  readonly ruleFilter = new FormControl('', { nonNullable: true });
  readonly objectTypeFilter = new FormControl('all', { nonNullable: true });

  // Dropdown options (populated from data)
  categoryOptions: string[] = [];
  objectOptions: string[] = [];
  filteredObjectOptions: string[] = [];

  // Pagination
  currentPage = 1;
  pageSize = 10;

  readonly displayedColumns = ['severity', 'category', 'rule', 'object', 'object_type', 'fix'];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly bpaService: BpaService,
    private readonly projectService: ProjectService,
    private readonly catalogService: CatalogService,
    private readonly inspectorService: InspectorService,
  ) {
    this.projectId = Number(this.route.snapshot.paramMap.get('id'));
    this.loadModelContext();
    this.refresh();
    this.severityFilter.valueChanges.subscribe(() => this.refresh());
    this.categoryFilter.valueChanges.subscribe(() => this.refresh());
    this.objectFilter.valueChanges.subscribe(() => this.filterObjects());
    this.ruleFilter.valueChanges.subscribe(() => this.refresh());
    this.objectTypeFilter.valueChanges.subscribe(() => this.refresh());
  }

  loadModelContext(): void {
    forkJoin({
      project: this.projectService.getById(this.projectId),
      catalog: this.catalogService.getCatalog(this.projectId),
      inspectorResults: this.inspectorService.getResults(this.projectId),
    }).subscribe(({ project, catalog, inspectorResults }) => {
      this.project = project;
      this.catalog = catalog;
      this.inspectorResults = inspectorResults;
    });
  }

  refresh(): void {
    const filters: Record<string, string> = {};
    if (this.severityFilter.value !== 'all') filters['severity'] = this.severityFilter.value;
    if (this.categoryFilter.value !== 'all') filters['category'] = this.categoryFilter.value;
    if (this.objectFilter.value) filters['objectName'] = this.objectFilter.value;
    if (this.ruleFilter.value) filters['ruleId'] = this.ruleFilter.value;
    if (this.objectTypeFilter.value !== 'all') filters['objectType'] = this.objectTypeFilter.value;

    this.currentPage = 1; // Reset to page 1 on filter change

    this.bpaService.getViolations(this.projectId, filters).subscribe((violations) => {
      this.violations = violations;
      this.buildFilterOptions(violations);
    });

    this.bpaService.getSummary(this.projectId).subscribe((summary) => {
      this.summary = summary;
    });
  }

  private buildFilterOptions(violations: BpaViolation[]): void {
    // Only rebuild on first load (all filters = default)
    if (this.categoryOptions.length === 0) {
      const cats = new Set<string>();
      const objs = new Set<string>();
      for (const v of violations) {
        if (v.category) cats.add(v.category);
        if (v.object_name) objs.add(v.object_name);
      }
      this.categoryOptions = Array.from(cats).sort();
      this.objectOptions = Array.from(objs).sort();
      this.filteredObjectOptions = this.objectOptions;
    }
  }

  filterObjects(): void {
    const val = this.objectFilter.value.toLowerCase();
    this.filteredObjectOptions = this.objectOptions.filter((opt) =>
      opt.toLowerCase().includes(val)
    );
    this.refresh();
  }

  // Pagination
  get totalPages(): number {
    return Math.ceil(this.filteredViolations.length / this.pageSize);
  }

  get filteredViolations(): BpaViolation[] {
    // Sort by category for default grouping
    return [...this.violations].sort((a, b) => a.category.localeCompare(b.category));
  }

  get paginatedViolations(): BpaViolation[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredViolations.slice(start, start + this.pageSize);
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    const current = this.currentPage;
    const pages: number[] = [];
    const range = 2; // show 2 pages before/after current

    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || (i >= current - range && i <= current + range)) {
        pages.push(i);
      }
    }
    return pages;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  export(): void {
    this.bpaService.export(this.projectId).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `project_${this.projectId}_bpa.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  tone(severity: number): 'error' | 'warning' | 'info' {
    if (severity >= 3) return 'error';
    if (severity === 2) return 'warning';
    return 'info';
  }

  get totalCount(): number {
    return this.violations.length;
  }

  get errorCount(): number {
    return this.violations.filter((v) => v.severity === 3).length;
  }

  get warningCount(): number {
    return this.violations.filter((v) => v.severity === 2).length;
  }

  get infoCount(): number {
    return this.violations.filter((v) => v.severity === 1).length;
  }

  get byCategory(): Array<{ label: string; value: number }> {
    const map = new Map<string, number>();
    for (const violation of this.violations) {
      map.set(violation.category, (map.get(violation.category) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }

  get bySeverity(): Array<{ label: string; value: number }> {
    return [
      { label: 'Error', value: this.errorCount },
      { label: 'Warning', value: this.warningCount },
      { label: 'Info', value: this.infoCount },
    ];
  }

  get topRules(): Array<{ label: string; value: number; tooltip?: string }> {
    return this.summary.slice(0, 4).map((item) => {
      // Find a violation with matching rule to get the description
      const match = this.violations.find((v) => v.rule_id === item.rule_id || v.rule_name === item.rule_name);
      return {
        label: item.rule_name,
        value: item.count,
        tooltip: match?.description || item.rule_name,
      };
    });
  }

  get modelCards(): Array<{ label: string; value: string | number }> {
    return [
      { label: 'Tables', value: this.project?.table_count || 0 },
      { label: 'Columns', value: this.project?.column_count || 0 },
      { label: 'Measures', value: this.project?.measure_count || 0 },
      { label: 'Relationships', value: this.project?.relationship_count || 0 },
      { label: 'Pages', value: this.project?.visual_count || this.visualCount },
      { label: 'Data Sources', value: this.project?.data_source_count || 0 },
    ];
  }

  get visualCount(): number {
    const pages = new Set(this.inspectorResults.map((item) => item.page_name).filter(Boolean));
    return pages.size;
  }

  get modelQualityScore(): number {
    if (!this.project) return 0;
    const bpa = this.project.bpa_violation_count || 0;
    return Math.max(0, Math.round(100 - (bpa * 0.09)));
  }

  get modelStats(): Array<{ label: string; value: string | number }> {
    return [
      { label: 'Roles', value: this.catalog?.roles.length || 0 },
      { label: 'Storage Mode', value: 'Import' },
      { label: 'Data Sources', value: (this.project?.data_sources || []).join(', ') || 'N/A' },
      { label: 'Culture', value: 'en-US / fr-FR' },
    ];
  }

  get scoreBreakdown(): Array<{ label: string; percent: number; tone: 'critical' | 'warning' | 'ok' }> {
    if (!this.totalCount) {
      return [
        { label: 'Naming', percent: 100, tone: 'ok' },
        { label: 'Performance', percent: 100, tone: 'ok' },
        { label: 'Formatting', percent: 100, tone: 'ok' },
      ];
    }

    const naming = this.summary
      .filter((item) => /naming|name/i.test(item.category))
      .reduce((sum, item) => sum + item.count, 0);
    const perf = this.summary
      .filter((item) => /performance|optimi/i.test(item.category))
      .reduce((sum, item) => sum + item.count, 0);
    const formatting = this.summary
      .filter((item) => /format|dax/i.test(item.category))
      .reduce((sum, item) => sum + item.count, 0);

    const toScore = (hits: number): number => {
      const ratio = Math.min(1, hits / Math.max(1, this.totalCount));
      return Math.round((1 - ratio) * 100);
    };

    return [
      { label: 'Naming', percent: toScore(naming), tone: this.scoreTone(toScore(naming)) },
      { label: 'Performance', percent: toScore(perf), tone: this.scoreTone(toScore(perf)) },
      { label: 'Formatting', percent: toScore(formatting), tone: this.scoreTone(toScore(formatting)) },
    ];
  }

  scrollTo(sectionId: string): void {
    const element = document.getElementById(sectionId);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private scoreTone(percent: number): 'critical' | 'warning' | 'ok' {
    if (percent < 55) return 'critical';
    if (percent < 80) return 'warning';
    return 'ok';
  }

  statusTone(status?: string): 'error' | 'warning' | 'info' | 'success' {
    if (status === 'ready') return 'success';
    if (status === 'error') return 'error';
    if (status === 'analyzing') return 'warning';
    return 'info';
  }

}
