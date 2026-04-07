import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Project,
  ScoreResponse,
  ScoreSummary,
} from '../shared/models/api.models';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  private readonly apiBase = 'http://127.0.0.1:5000/api/projects';

  constructor(private readonly http: HttpClient) {}

  list(): Observable<Project[]> {
    return this.http.get<Project[]>(this.apiBase);
  }

  getById(projectId: number): Observable<Project> {
    return this.http.get<Project>(`${this.apiBase}/${projectId}`);
  }

  create(payload: { name: string; description?: string }): Observable<Project> {
    return this.http.post<Project>(this.apiBase, payload);
  }

  delete(projectId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiBase}/${projectId}`);
  }

  upload(projectId: number, file: File): Observable<unknown> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.apiBase}/${projectId}/upload`, formData);
  }

  uploadFolder(projectId: number, files: File[]): Observable<unknown> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      formData.append('paths', relativePath);
    }
    return this.http.post(`${this.apiBase}/${projectId}/upload`, formData);
  }

  analyze(projectId: number): Observable<unknown> {
    return this.http.post(`${this.apiBase}/${projectId}/analyze`, {});
  }

  getHealthRadar(projectId: number): Observable<{ axes: Array<{ axis: string; score: number; violations: number }> }> {
    return this.http.get<{ axes: Array<{ axis: string; score: number; violations: number }> }>(`${this.apiBase}/${projectId}/health-radar`);
  }

  getScores(projectId: number): Observable<ScoreResponse> {
    return this.http.get<ScoreResponse>(`${this.apiBase}/${projectId}/scores`);
  }

  getScoreSummary(projectId: number): Observable<ScoreSummary> {
    return this.http.get<ScoreSummary>(`${this.apiBase}/${projectId}/scores/summary`);
  }

  updateDatasetSize(projectId: number, value: string): Observable<{ project_id: number; dataset_size: string | null }> {
    return this.http.put<{ project_id: number; dataset_size: string | null }>(
      `${this.apiBase}/${projectId}/dataset-size`,
      { value }
    );
  }

  getDatasetSizeHistory(projectId: number, limit = 100): Observable<{ project_id: number; history: Array<{ value: string | null; created_at: string | null }> }> {
    return this.http.get<{ project_id: number; history: Array<{ value: string | null; created_at: string | null }> }>(
      `${this.apiBase}/${projectId}/dataset-size/history?limit=${limit}`
    );
  }
}
