import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BpaSummary, BpaViolation } from '../shared/models/api.models';

@Injectable({
  providedIn: 'root'
})
export class BpaService {
  private readonly apiBase = 'http://127.0.0.1:5000/api/projects';

  constructor(private readonly http: HttpClient) {}

  getViolations(projectId: number, filters?: Record<string, string | number | boolean | undefined>): Observable<BpaViolation[]> {
    let params = new HttpParams();
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== '') {
          params = params.set(key, String(value));
        }
      }
    }
    return this.http.get<BpaViolation[]>(`${this.apiBase}/${projectId}/bpa`, { params });
  }

  getSummary(projectId: number): Observable<BpaSummary[]> {
    return this.http.get<BpaSummary[]>(`${this.apiBase}/${projectId}/bpa/summary`);
  }

  export(projectId: number): Observable<Blob> {
    return this.http.get(`${this.apiBase}/${projectId}/export/bpa`, { responseType: 'blob' });
  }
}
