import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CatalogMeasure,
  CatalogRelationship,
  CatalogResponse,
  CatalogRole,
  CatalogTable,
} from '../shared/models/api.models';

@Injectable({
  providedIn: 'root'
})
export class CatalogService {
  private readonly apiBase = 'http://127.0.0.1:5000/api/projects';

  constructor(private readonly http: HttpClient) {}

  getCatalog(projectId: number, tableName?: string): Observable<CatalogResponse> {
    let params = new HttpParams();
    if (tableName) params = params.set('table', tableName);
    return this.http.get<CatalogResponse>(`${this.apiBase}/${projectId}/catalog`, { params });
  }

  getTables(projectId: number): Observable<CatalogTable[]> {
    return this.http.get<CatalogTable[]>(`${this.apiBase}/${projectId}/catalog/tables`);
  }

  getMeasures(projectId: number, filters?: { table?: string; folder?: string; search?: string }): Observable<CatalogMeasure[]> {
    let params = new HttpParams();
    if (filters?.table) params = params.set('table', filters.table);
    if (filters?.folder) params = params.set('folder', filters.folder);
    if (filters?.search) params = params.set('search', filters.search);
    return this.http.get<CatalogMeasure[]>(`${this.apiBase}/${projectId}/catalog/measures`, { params });
  }

  getRelationships(projectId: number, filters?: { table?: string; active?: boolean }): Observable<CatalogRelationship[]> {
    let params = new HttpParams();
    if (filters?.table) params = params.set('table', filters.table);
    if (filters?.active !== undefined) params = params.set('active', String(filters.active));
    return this.http.get<CatalogRelationship[]>(`${this.apiBase}/${projectId}/catalog/relationships`, { params });
  }

  getRoles(projectId: number): Observable<CatalogRole[]> {
    return this.http.get<CatalogRole[]>(`${this.apiBase}/${projectId}/catalog/roles`);
  }

  exportCatalog(projectId: number): Observable<Blob> {
    return this.http.get(`${this.apiBase}/${projectId}/export/catalog`, { responseType: 'blob' });
  }
}
