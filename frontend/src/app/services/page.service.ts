import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

interface PageData {
  name: string;
  displayName: string;
  width: number;
  height: number;
  visuals: Array<{
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class PageService {
  private baseUrl = '/api/projects';

  constructor(private http: HttpClient) {}

  getPages(projectId: number): Observable<{ pages: PageData[]; bookmarks: any[] }> {
    return this.http.get<{ pages: PageData[]; bookmarks: any[] }>(`${this.baseUrl}/${projectId}/pages`);
  }
}
