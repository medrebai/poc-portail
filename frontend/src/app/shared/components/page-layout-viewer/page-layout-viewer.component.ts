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
      other: 'Other',
    };
    return categoryMap[type.toLowerCase()] || 'Unknown';
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
