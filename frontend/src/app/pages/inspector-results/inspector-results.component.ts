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
import { forkJoin } from 'rxjs';
import { InspectorService } from '../../services/inspector.service';
import { ProjectService } from '../../services/project.service';
import { PageService } from '../../services/page.service';
import { InspectorResult, Project } from '../../shared/models/api.models';
import { SeverityBadgeComponent } from '../../shared/components/severity-badge/severity-badge.component';
import { ChartCardComponent } from '../../shared/components/chart-card/chart-card.component';
import { PageLayoutViewerComponent } from '../../shared/components/page-layout-viewer/page-layout-viewer.component';

@Component({
  selector: 'app-inspector-results',
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
    SeverityBadgeComponent,
    ChartCardComponent,
    PageLayoutViewerComponent,
  ],
  templateUrl: './inspector-results.component.html',
  styleUrl: './inspector-results.component.scss'
})
export class InspectorResultsComponent {
  readonly projectId: number;
  project: Project | null = null;
  results: InspectorResult[] = [];
  pages: any[] = [];

  readonly passedFilter = new FormControl('all', { nonNullable: true });
  readonly pageFilter = new FormControl('', { nonNullable: true });
  readonly ruleFilter = new FormControl('', { nonNullable: true });

  pageOptions: string[] = [];
  filteredPageOptions: string[] = [];

  ruleOptions: string[] = [];
  filteredRuleOptions: string[] = [];

  // Pagination
  currentPage = 1;
  pageSize = 10;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly inspectorService: InspectorService,
    private readonly projectService: ProjectService,
    private readonly pageService: PageService,
  ) {
    this.projectId = Number(this.route.snapshot.paramMap.get('id'));
    this.loadProjectContext();
    this.refresh();
    this.loadPages();
    this.passedFilter.valueChanges.subscribe(() => this.refresh());
    this.pageFilter.valueChanges.subscribe(() => this.filterPages());
    this.ruleFilter.valueChanges.subscribe(() => this.filterRules());
  }

  loadProjectContext(): void {
    this.projectService.getById(this.projectId).subscribe((project) => {
      this.project = project;
    });
  }

  loadPages(): void {
    this.pageService.getPages(this.projectId).subscribe({
      next: (response) => {
        this.pages = response.pages || [];
      },
      error: () => {
        this.pages = [];
      }
    });
  }

  refresh(): void {
    const filters: Record<string, string | boolean> = {};
    if (this.passedFilter.value !== 'all') {
      filters['passed'] = this.passedFilter.value === 'passed';
    }
    if (this.pageFilter.value) filters['page'] = this.pageFilter.value;
    if (this.ruleFilter.value) filters['rule'] = this.ruleFilter.value;

    this.currentPage = 1;

    this.inspectorService.getResults(this.projectId, filters as any).subscribe((results) => {
      this.results = results;
      this.buildFilterOptions(results);
    });
  }

  private buildFilterOptions(results: InspectorResult[]): void {
    if (this.pageOptions.length === 0) {
      const pages = new Set<string>();
      for (const r of results) {
        if (r.page_name) pages.add(r.page_name);
      }
      pages.add('Report level');
      this.pageOptions = Array.from(pages).sort();
      this.filteredPageOptions = this.pageOptions;
    }

    if (this.ruleOptions.length === 0) {
      const rules = new Set<string>();
      for (const r of results) {
        if (r.rule_name) rules.add(r.rule_name);
      }
      this.ruleOptions = Array.from(rules).sort();
      this.filteredRuleOptions = this.ruleOptions;
    }
  }

  filterPages(): void {
    const val = this.pageFilter.value.toLowerCase();
    this.filteredPageOptions = this.pageOptions.filter((opt) =>
      opt.toLowerCase().includes(val)
    );
    this.refresh();
  }

  filterRules(): void {
    const val = this.ruleFilter.value.toLowerCase();
    this.filteredRuleOptions = this.ruleOptions.filter((opt) =>
      opt.toLowerCase().includes(val)
    );
    this.refresh();
  }

  get totalPages(): number {
    return Math.ceil(this.filteredResults.length / this.pageSize);
  }

  get filteredResults(): InspectorResult[] {
    return [...this.results].sort((a, b) => {
      const pageA = a.page_name || 'Report level';
      const pageB = b.page_name || 'Report level';
      return pageA.localeCompare(pageB);
    });
  }

  get paginatedResults(): InspectorResult[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredResults.slice(start, start + this.pageSize);
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    const current = this.currentPage;
    const pages: number[] = [];
    const range = 2;

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
    this.inspectorService.export(this.projectId).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `project_${this.projectId}_inspector.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  scrollTo(sectionId: string): void {
    const element = document.getElementById(sectionId);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  get total(): number {
    return this.results.length;
  }

  get passed(): number {
    return this.results.filter((r) => r.passed).length;
  }

  get failed(): number {
    return this.total - this.passed;
  }

  get passFailChart(): Array<{ label: string; value: number }> {
    return [
      { label: 'Passed', value: this.passed },
      { label: 'Failed', value: this.failed },
    ];
  }

  get failedByPageChart(): Array<{ label: string; value: number }> {
    const map = new Map<string, number>();
    for (const result of this.results.filter((r) => !r.passed)) {
      const page = result.page_name || 'Report level';
      map.set(page, (map.get(page) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }

  get byPageChart(): Array<{ label: string; value: number }> {
    const map = new Map<string, number>();
    for (const result of this.results) {
      const page = result.page_name || 'Report level';
      map.set(page, (map.get(page) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }

  roundPercentage(passed: number, total: number): number {
    return total ? Math.round((passed / total) * 100) : 0;
  }

  get avgRulesPerPage(): number {
    if (!this.project?.visual_count || this.total === 0) return 0;
    return Math.round(this.total / this.project.visual_count);
  }

  statusTone(status?: string): 'error' | 'warning' | 'info' | 'success' {
    if (status === 'ready') return 'success';
    if (status === 'error') return 'error';
    if (status === 'analyzing') return 'warning';
    return 'info';
  }

  getPageCount(): number {
    const pages = new Set(this.results.map((r) => r.page_name).filter(Boolean));
    return pages.size;
  }

}
