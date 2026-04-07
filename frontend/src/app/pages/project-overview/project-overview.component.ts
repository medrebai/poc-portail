import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { forkJoin } from 'rxjs';
import { BpaService } from '../../services/bpa.service';
import { InspectorService } from '../../services/inspector.service';
import { ProjectService } from '../../services/project.service';
import { BpaSummary, InspectorResult, Project, ScoreResponse } from '../../shared/models/api.models';
import { SeverityBadgeComponent } from '../../shared/components/severity-badge/severity-badge.component';

@Component({
  selector: 'app-project-overview',
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatProgressBarModule,
    SeverityBadgeComponent,
  ],
  templateUrl: './project-overview.component.html',
  styleUrl: './project-overview.component.scss'
})
export class ProjectOverviewComponent {
  projectId = 0;
  project: Project | null = null;
  bpaSummary: BpaSummary[] = [];
  inspectorResults: InspectorResult[] = [];
  tags: string[] = [];
  newTag = '';
  isAddingTag = false;
  radarAxes: Array<{ axis: string; score: number; violations: number }> = [];
  scores: ScoreResponse | null = null;
  private readonly axisDescriptions: Record<string, string> = {
    'Naming': 'Naming conventions quality for tables, columns, and measures.',
    'Performance': 'Model patterns that can impact query speed and report responsiveness.',
    'DAX Quality': 'DAX expression quality, readability, and reliability best practices.',
    'Formatting': 'Model formatting and layout consistency for maintainability.',
    'Maintenance': 'Long-term maintainability signals such as metadata and technical debt indicators.',
    'Error Prevention': 'Rules that reduce risks of ambiguous logic, broken calculations, and incorrect results.',
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly projectService: ProjectService,
    private readonly bpaService: BpaService,
    private readonly inspectorService: InspectorService,
  ) {
    this.projectId = Number(this.route.snapshot.paramMap.get('id'));
    this.loadData();
  }

  loadData(): void {
    forkJoin({
      project: this.projectService.getById(this.projectId),
      bpaSummary: this.bpaService.getSummary(this.projectId),
      inspectorResults: this.inspectorService.getResults(this.projectId),
      scores: this.projectService.getScores(this.projectId),
    }).subscribe({
      next: ({ project, bpaSummary, inspectorResults, scores }) => {
      this.project = project;
      this.bpaSummary = bpaSummary;
      this.inspectorResults = inspectorResults;
      this.scores = scores;
      this.loadTags();
      },
      error: () => undefined,
    });

    this.projectService.getHealthRadar(this.projectId).subscribe({
      next: (data) => this.radarAxes = data.axes,
      error: () => this.radarAxes = [],
    });
  }

  statusTone(status?: string): 'error' | 'warning' | 'info' | 'success' {
    if (status === 'ready') return 'success';
    if (status === 'error') return 'error';
    if (status === 'analyzing') return 'warning';
    return 'info';
  }

  get qualityScore(): number {
    if (!this.scores) return 0;
    return Math.round(this.scores.overall_score);
  }

  get totalChecks(): number {
    if (!this.project) return 0;
    return (this.project.bpa_violation_count || 0) + (this.project.inspector_total || 0);
  }

  get hasDescription(): boolean {
    return !!this.project?.description?.trim();
  }

  get bpaViolationCount(): number {
    return this.project?.bpa_violation_count || 0;
  }

  get inspectorFailCount(): number {
    return this.project?.inspector_failed_count || 0;
  }

  get inspectorTotalChecks(): number {
    return this.project?.inspector_total || 0;
  }

  get qualityScoreBreakdown(): string {
    if (!this.scores) return 'Scoring unavailable';
    return `${this.modelWeightPercent}% Model + ${this.visualWeightPercent}% Visual`;
  }

  get modelWeightPercent(): number {
    return Math.round((this.scores?.model_weight || 0) * 100);
  }

  get visualWeightPercent(): number {
    return Math.round((this.scores?.visual_weight || 0) * 100);
  }

  get modelWeightedContribution(): number {
    if (!this.scores) return 0;
    return this.scores.model_score * this.scores.model_weight;
  }

  get visualWeightedContribution(): number {
    if (!this.scores) return 0;
    return this.scores.visual_score * this.scores.visual_weight;
  }

  get overallGrade(): string {
    return this.scores?.overall_grade || 'N/A';
  }

  get overallLabel(): string {
    return this.scores?.overall_label || 'Not Available';
  }

  get overallColor(): string {
    return this.scores?.overall_color || '#9ca3af';
  }

  get modelScore(): number {
    return this.scores?.model_score || 0;
  }

  get visualScore(): number {
    return this.scores?.visual_score || 0;
  }

  get modelGrade(): string {
    return this.scoreToGrade(this.modelScore);
  }

  get visualGrade(): string {
    return this.scoreToGrade(this.visualScore);
  }

  private scoreToGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  get modelCategoryScores(): Array<{ label: string; score: number; detail: string }> {
    return (this.scores?.model_categories || []).map((category) => ({
      label: category.name,
      score: category.score,
      detail: `${category.errors} errors, ${category.warnings} warnings`,
    }));
  }

  get visualCategoryScores(): Array<{ label: string; score: number; detail: string }> {
    return (this.scores?.visual_categories || []).map((category) => ({
      label: category.name,
      score: category.score,
      detail: `${category.passed}/${category.total} passed`,
    }));
  }

  get scoreCategoryTiles(): Array<{
    pillar: 'Model' | 'Visual';
    label: string;
    score: number;
    detail: string;
    drilldowns: Array<{ label: string; severity: number; count: number }>;
  }> {
    const model = this.modelCategoryScores.map((category) => ({
      pillar: 'Model' as const,
      label: category.label,
      score: category.score,
      detail: category.detail,
      drilldowns: this.getCategorySeverityDrilldowns(category.label),
    }));
    const visual = this.visualCategoryScores.map((category) => ({
      pillar: 'Visual' as const,
      label: category.label,
      score: category.score,
      detail: category.detail,
      drilldowns: [],
    }));
    return [...model, ...visual];
  }

  getCategorySeverityDrilldowns(category: string): Array<{ label: string; severity: number; count: number }> {
    return [
      { label: 'Error', severity: 3, count: this.getCategorySeverityCount(category, 3) },
      { label: 'Warning', severity: 2, count: this.getCategorySeverityCount(category, 2) },
      { label: 'Info', severity: 1, count: this.getCategorySeverityCount(category, 1) },
    ];
  }

  bpaDrilldownQueryParams(category: string, severity?: number): Record<string, string> {
    const params: Record<string, string> = {
      category,
      focus: 'violations-list',
    };
    if (severity) {
      params['severity'] = String(severity);
    }
    return params;
  }

  private getCategorySeverityCount(category: string, severity: number): number {
    return this.bpaSummary
      .filter((item) => item.category === category && item.severity === severity)
      .reduce((sum, item) => sum + item.count, 0);
  }

  get evaluatedRuleBreakdown(): string {
    return `${this.inspectorTotalChecks} visual checks + ${this.bpaViolationCount} model violations`; 
  }

  get semanticModelBreakdown(): string {
    return `${this.bpaViolationCount} non-compliant semantic model rules`;
  }

  get visualBreakdown(): string {
    return `${this.inspectorFailCount} failed visual inspector checks`;
  }

  get performanceLabel(): string {
    return 'NaN';
  }

  get statusText(): string {
    if (!this.project?.status) return 'Unknown';
    return this.project.status.charAt(0).toUpperCase() + this.project.status.slice(1);
  }

  get totalModelObjects(): number {
    if (!this.project) return 0;
    return (this.project.table_count || 0) + (this.project.measure_count || 0) + (this.project.column_count || 0);
  }

  get documentationCount(): number {
    return this.project?.analysis_meta ? Object.keys(this.project.analysis_meta).length : 0;
  }

  get axisIndices(): number[] {
    return this.radarAxes.map((_, i) => i);
  }

  private polarToXY(centerX: number, centerY: number, radius: number, angleIndex: number, total: number): { x: number; y: number } {
    const angle = (Math.PI * 2 * angleIndex) / total - Math.PI / 2;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  }

  getPolygonPoints(scale: number): string {
    const cx = 150, cy = 150, r = 110;
    const n = this.radarAxes.length || 1;
    return Array.from({ length: n }, (_, i) => {
      const p = this.polarToXY(cx, cy, r * scale, i, n);
      return `${p.x},${p.y}`;
    }).join(' ');
  }

  getAxisX(i: number): number {
    return this.polarToXY(150, 150, 110, i, this.radarAxes.length).x;
  }

  getAxisY(i: number): number {
    return this.polarToXY(150, 150, 110, i, this.radarAxes.length).y;
  }

  get dataPolygonPoints(): string {
    const cx = 150, cy = 150, r = 110;
    const n = this.radarAxes.length || 1;
    return this.radarAxes.map((ax, i) => {
      const p = this.polarToXY(cx, cy, r * (ax.score / 100), i, n);
      return `${p.x},${p.y}`;
    }).join(' ');
  }

  get radarPoints(): Array<{ axis: string; x: number; y: number }> {
    const cx = 150, cy = 150, r = 110;
    const n = this.radarAxes.length || 1;
    return this.radarAxes.map((ax, i) => {
      const p = this.polarToXY(cx, cy, r * (ax.score / 100), i, n);
      return { axis: ax.axis, x: p.x, y: p.y };
    });
  }

  get radarLabels(): Array<{ axis: string; x: number; y: number }> {
    const cx = 150, cy = 150, r = 130;
    const n = this.radarAxes.length || 1;
    return this.radarAxes.map((ax, i) => {
      const p = this.polarToXY(cx, cy, r, i, n);
      return { axis: ax.axis, x: p.x, y: p.y };
    });
  }

  getAxisDescription(axis: string): string {
    return this.axisDescriptions[axis] || 'Quality category measured by BPA rules.';
  }

  addTag(): void {
    const value = this.newTag.trim();
    if (!value) return;

    const normalized = value.toLowerCase();
    const exists = this.tags.some((tag) => tag.toLowerCase() === normalized);
    if (exists) {
      this.newTag = '';
      return;
    }

    this.tags = [...this.tags, value];
    this.newTag = '';
    this.isAddingTag = false;
    this.saveTags();
  }

  removeTag(tag: string): void {
    this.tags = this.tags.filter((current) => current !== tag);
    this.saveTags();
  }

  openTagInput(): void {
    this.isAddingTag = true;
  }

  cancelTagInput(): void {
    this.isAddingTag = false;
    this.newTag = '';
  }

  private loadTags(): void {
    const key = this.tagsStorageKey;
    if (!key) {
      this.tags = [];
      return;
    }

    const raw = localStorage.getItem(key);
    if (!raw) {
      this.tags = ['certified', 'finance', 'sales'];
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      this.tags = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && !!item.trim())
        : ['certified', 'finance', 'sales'];
    } catch {
      this.tags = ['certified', 'finance', 'sales'];
    }
  }

  private saveTags(): void {
    const key = this.tagsStorageKey;
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(this.tags));
  }

  private get tagsStorageKey(): string | null {
    if (!this.projectId) return null;
    return `project-overview-tags-${this.projectId}`;
  }

  scrollTo(sectionId: string): void {
    const element = document.getElementById(sectionId);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  getPageCount(): number {
    const pages = new Set(this.inspectorResults.map((r) => r.page_name).filter(Boolean));
    return pages.size;
  }

}
