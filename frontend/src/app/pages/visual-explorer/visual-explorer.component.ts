import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { forkJoin, timeout } from 'rxjs';
import { PageService } from '../../services/page.service';
import { LineageService, LineageNode, LineageEdge } from '../../services/lineage.service';
import { PageLayoutViewerComponent } from '../../shared/components/page-layout-viewer/page-layout-viewer.component';
import { LineageRendererComponent } from '../../shared/components/lineage-renderer/lineage-renderer.component';

@Component({
  selector: 'app-visual-explorer',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    PageLayoutViewerComponent,
    LineageRendererComponent,
  ],
  templateUrl: './visual-explorer.component.html',
  styleUrl: './visual-explorer.component.scss',
})
export class VisualExplorerComponent {
  readonly projectId: number;
  pages: any[] = [];

  // Lineage
  @ViewChild('lineageContainer') lineageContainer!: ElementRef;
  private readonly defaultLineageZoom = 1.2;
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

  activeSection: 'page-layout' | 'lineage' = 'page-layout';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly pageService: PageService,
    private readonly lineageService: LineageService,
  ) {
    this.projectId = Number(this.route.snapshot.paramMap.get('id'));
    this.loadPages();
  }

  // ── Page Layout ──────────────────────────────────────────

  loadPages(): void {
    this.pageService.getPages(this.projectId).subscribe({
      next: (response) => {
        this.pages = response.pages || [];
      },
      error: () => {
        this.pages = [];
      },
    });
  }

  // ── Lineage ──────────────────────────────────────────────

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

  scrollTo(id: string): void {
    this.activeSection = id as any;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lineage_project_${this.projectId}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
