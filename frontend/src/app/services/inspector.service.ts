import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { InspectorResult } from '../shared/models/api.models';

@Injectable({
  providedIn: 'root'
})
export class InspectorService {
  private readonly apiBase = 'http://127.0.0.1:5000/api/projects';

  constructor(private readonly http: HttpClient) {}

  getResults(projectId: number, filters?: { passed?: boolean; page?: string; sort?: string }): Observable<InspectorResult[]> {
    let params = new HttpParams();
    if (filters?.passed !== undefined) params = params.set('passed', String(filters.passed));
    if (filters?.page) params = params.set('page', filters.page);
    if (filters?.sort) params = params.set('sort', filters.sort);

    return this.http.get<InspectorResult[]>(`${this.apiBase}/${projectId}/inspector`, { params });
  }

  export(projectId: number): Observable<Blob> {
    return this.http.get(`${this.apiBase}/${projectId}/export/inspector`, { responseType: 'blob' });
  }
}
