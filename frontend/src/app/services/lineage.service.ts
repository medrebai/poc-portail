import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PartitionImportRow } from '../shared/models/api.models';

export interface LineageNode {
  id: string;
  type: 'dataSource' | 'table' | 'column' | 'measure' | 'visual';
  name: string;
  detail?: string;
  metadata?: Record<string, any>;
}

export interface LineageEdge {
  from: string;
  to: string;
  type: string;
  style?: 'solid' | 'dashed';
  label?: string;
}

export interface LineageResponse {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

@Injectable({ providedIn: 'root' })
export class LineageService {
  private readonly apiBase = 'http://127.0.0.1:5000/api/projects';

  constructor(private readonly http: HttpClient) {}

  getFullLineage(projectId: number): Observable<LineageResponse> {
    return this.http.get<LineageResponse>(`${this.apiBase}/${projectId}/lineage`);
  }

  getVisualTrace(projectId: number, page: string, visual: string): Observable<LineageResponse> {
    const params = new HttpParams().set('page', page).set('visual', visual);
    return this.http.get<LineageResponse>(`${this.apiBase}/${projectId}/lineage/visual-trace`, { params });
  }

  getMeasureImpact(projectId: number, measure: string): Observable<LineageResponse> {
    const params = new HttpParams().set('measure', measure);
    return this.http.get<LineageResponse>(`${this.apiBase}/${projectId}/lineage/measure-impact`, { params });
  }

  getColumnImpact(projectId: number, table: string, column: string): Observable<LineageResponse> {
    const params = new HttpParams().set('table', table).set('column', column);
    return this.http.get<LineageResponse>(`${this.apiBase}/${projectId}/lineage/column-impact`, { params });
  }

  getVisuals(projectId: number): Observable<Array<{ page: string; name: string }>> {
    return this.http.get<Array<{ page: string; name: string }>>(`${this.apiBase}/${projectId}/lineage/visuals`);
  }

  getMeasures(projectId: number): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiBase}/${projectId}/lineage/measures`);
  }

  getTables(projectId: number): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiBase}/${projectId}/lineage/tables`);
  }

  getColumns(projectId: number, table: string): Observable<string[]> {
    const params = new HttpParams().set('table', table);
    return this.http.get<string[]>(`${this.apiBase}/${projectId}/lineage/columns`, { params });
  }

  getPartitions(projectId: number): Observable<PartitionImportRow[]> {
    return this.http.get<PartitionImportRow[]>(`${this.apiBase}/${projectId}/catalog/partitions`);
  }
}
