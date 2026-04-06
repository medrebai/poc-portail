import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCardModule } from '@angular/material/card';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

interface Visual {
  id: string;
  name: string;
  title: string;
  type: string;
  category: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fields: string[];
}

interface PageData {
  name: string;
  displayName: string;
  width: number;
  height: number;
  visuals: Visual[];
}

@Component({
  selector: 'app-page-layout-viewer',
  standalone: true,
  imports: [
    CommonModule,
    MatSelectModule,
    MatFormFieldModule,
    MatCardModule,
    ReactiveFormsModule,
  ],
  templateUrl: './page-layout-viewer.component.html',
  styleUrl: './page-layout-viewer.component.scss'
})
export class PageLayoutViewerComponent implements OnInit {
  @Input() projectId: number = 0;
  @Input() pages: PageData[] = [];
  pageControl = new FormControl<string>('');
  selectedPage: PageData | null = null;
  hoveredVisual: Visual | null = null;
  scale = 0.5;

  ngOnInit(): void {
    if (this.pages.length > 0) {
      this.pageControl.setValue(this.pages[0].name);
      this.selectPage(this.pages[0].name);
    }

    this.pageControl.valueChanges.subscribe((pageName) => {
      if (pageName) {
        this.selectPage(pageName);
      }
    });

  }

  selectPage(pageName: string): void {
    this.selectedPage = this.pages.find((p) => p.name === pageName) || null;
    this.hoveredVisual = null;
  }

  getVisualColor(type: string): string {
    const typeMap: Record<string, string> = {
      slicer: '#0891b2',  // teal
      chart: '#f97316',   // orange
      table: '#3b82f6',   // blue
      card: '#8b5cf6',    // purple
      map: '#10b981',     // green
      text: '#6b7280',    // gray
      shape: '#94a3b8',   // slate (background)
      other: '#9ca3af',   // light gray
    };
    return typeMap[type.toLowerCase()] || typeMap['other'];
  }

  getVisualCategory(type: string): string {
    const categoryMap: Record<string, string> = {
      slicer: 'Slicer',
      chart: 'Chart',
      table: 'Table',
      card: 'Card/KPI',
      map: 'Map',
      text: 'Text',
      shape: 'Shape',
      other: 'Other',
    };
    return categoryMap[type.toLowerCase()] || 'Unknown';
  }

  isBackgroundVisual(visual: Visual): boolean {
    const visualType = (visual.type || '').toLowerCase();
    const category = (visual.category || '').toLowerCase();
    return (
      visualType.includes('shape') ||
      visualType === 'unknown' ||
      category === 'shape' ||
      category === 'unknown' ||
      category === 'other'
    );
  }

  get visualRenderOrder(): Visual[] {
    if (!this.selectedPage) return [];

    // Render background visuals first so they stay in the back layer.
    const withIndex = this.selectedPage.visuals.map((visual, index) => ({ visual, index }));
    withIndex.sort((a, b) => {
      const aBg = this.isBackgroundVisual(a.visual) ? 0 : 1;
      const bBg = this.isBackgroundVisual(b.visual) ? 0 : 1;
      if (aBg !== bBg) return aBg - bBg;
      return a.index - b.index;
    });
    return withIndex.map((entry) => entry.visual);
  }

  getVisualLayer(visual: Visual): number {
    return this.isBackgroundVisual(visual) ? 1 : 2;
  }

  shouldShowVisualLabel(visual: Visual): boolean {
    const scaledWidth = visual.width * this.scale;
    const scaledHeight = visual.height * this.scale;
    const label = this.getVisualDisplayLabel(visual);
    if (!label) {
      return false;
    }

    // Let short labels appear on smaller visuals while still preventing vertical text stacks.
    const compactLabel = label.length <= 10;
    const minWidth = compactLabel ? 48 : 60;
    return scaledWidth >= minWidth && scaledHeight >= 20;
  }

  getVisualDisplayLabel(visual: Visual): string {
    return (visual.title || visual.name || visual.type || visual.id || '').trim();
  }

  onVisualHover(visual: Visual): void {
    this.hoveredVisual = visual;
  }

  onVisualLeave(): void {
    this.hoveredVisual = null;
  }

  get canvasWidth(): number {
    return (this.selectedPage?.width || 1280) * this.scale;
  }

  get canvasHeight(): number {
    return (this.selectedPage?.height || 720) * this.scale;
  }
}
