import { Component } from '@angular/core';
import { OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { ProjectService } from '../../services/project.service';
import { Project } from '../../shared/models/api.models';
import { SeverityBadgeComponent } from '../../shared/components/severity-badge/severity-badge.component';

@Component({
  selector: 'app-project-list',
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
    MatChipsModule,
    SeverityBadgeComponent,
  ],
  templateUrl: './project-list.component.html',
  styleUrl: './project-list.component.scss'
})
export class ProjectListComponent implements OnInit {
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly statusControl = new FormControl('all', { nonNullable: true });

  loading = false;
  projects: Project[] = [];
  filtered: Project[] = [];
  readonly displayedColumns = ['name', 'status', 'model', 'quality', 'created', 'actions'];
  pageIndex = 0;
  readonly pageSize = 5;

  constructor(private readonly projectService: ProjectService) {}

  ngOnInit(): void {
    this.loadProjects();
    this.searchControl.valueChanges.subscribe(() => this.applyFilters());
    this.statusControl.valueChanges.subscribe(() => this.applyFilters());
  }

  loadProjects(): void {
    this.loading = true;
    this.projectService.list().subscribe({
      next: (projects) => {
        this.projects = projects;
        this.applyFilters();
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  applyFilters(): void {
    const search = this.searchControl.value.toLowerCase().trim();
    const status = this.statusControl.value;

    this.filtered = this.projects.filter((project) => {
      const matchesSearch =
        !search ||
        project.name.toLowerCase().includes(search) ||
        (project.description ?? '').toLowerCase().includes(search);

      const matchesStatus = status === 'all' || project.status === status;
      return matchesSearch && matchesStatus;
    });

    this.filtered = [...this.filtered].sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });

    this.pageIndex = 0;
  }

  deleteProject(project: Project): void {
    if (!confirm(`Delete project "${project.name}" and all analysis data?`)) return;

    this.projectService.delete(project.id).subscribe({
      next: () => this.loadProjects(),
    });
  }

  statusTone(status: string): 'error' | 'warning' | 'info' | 'success' {
    if (status === 'ready') return 'success';
    if (status === 'error') return 'error';
    if (status === 'analyzing') return 'warning';
    return 'info';
  }

  get totalProjects(): number {
    return this.projects.length;
  }

  get readyProjects(): number {
    return this.projects.filter((project) => project.status === 'ready').length;
  }

  get totalBpaViolations(): number {
    return this.projects.reduce((sum, project) => sum + (project.bpa_violation_count || 0), 0);
  }

  get totalInspectorFails(): number {
    return this.projects.reduce((sum, project) => sum + (project.inspector_failed_count || 0), 0);
  }

  get highRiskProjects(): number {
    return this.projects.filter((project) => (project.bpa_violation_count || 0) > 500 || (project.inspector_failed_count || 0) > 20).length;
  }

  get latestUpdatedAt(): string | null {
    const timestamps = this.projects
      .map((project) => project.updated_at || project.created_at)
      .filter((value): value is string => !!value)
      .sort();
    return timestamps.length ? timestamps[timestamps.length - 1] : null;
  }

  get topProjectsByViolations(): Project[] {
    return [...this.projects]
      .sort((a, b) => (b.bpa_violation_count || 0) - (a.bpa_violation_count || 0))
      .slice(0, 3);
  }

  get latestFiveProjects(): Project[] {
    return this.filtered.slice(0, 3);
  }

  get olderProjects(): Project[] {
    return this.filtered.slice(3);
  }

  get pagedOlderProjects(): Project[] {
    const start = this.pageIndex * this.pageSize;
    const end = start + this.pageSize;
    return this.olderProjects.slice(start, end);
  }

  get totalOlderPages(): number {
    return Math.max(1, Math.ceil(this.olderProjects.length / this.pageSize));
  }

  prevPage(): void {
    this.pageIndex = Math.max(0, this.pageIndex - 1);
  }

  nextPage(): void {
    this.pageIndex = Math.min(this.totalOlderPages - 1, this.pageIndex + 1);
  }

  projectTags(project: Project): string[] {
    const tags: string[] = [];

    if ((project.bpa_violation_count || 0) > 500) tags.push('High BPA');
    if ((project.inspector_failed_count || 0) > 20) tags.push('Visual Alerts');
    if (project.status === 'ready') tags.push('Ready');
    if (project.status === 'analyzing') tags.push('Running');
    if ((project.table_count || 0) > 30) tags.push('Large Model');

    if (!tags.length) tags.push('Baseline');
    return tags.slice(0, 3);
  }

  bpaMetricClass(project: Project): string {
    const count = project.bpa_violation_count || 0;
    if (count >= 300) return 'metric-critical';
    if (count > 0) return 'metric-warning';
    return 'metric-ok';
  }

  inspectorMetricClass(project: Project): string {
    const count = project.inspector_failed_count || 0;
    if (count >= 20) return 'metric-critical';
    if (count > 0) return 'metric-warning';
    return 'metric-ok';
  }

  tagClass(tag: string): string {
    if (tag === 'High BPA') return 'tag-danger';
    if (tag === 'Visual Alerts') return 'tag-warning';
    if (tag === 'Running') return 'tag-info';
    if (tag === 'Ready') return 'tag-ok';
    if (tag === 'Large Model') return 'tag-neutral';
    return 'tag-soft';
  }

}
