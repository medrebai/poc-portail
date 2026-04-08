import { Component, OnDestroy } from '@angular/core';
import { Router, NavigationEnd, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Subscription, filter } from 'rxjs';
import { ProjectService } from './services/project.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnDestroy {
  projectId: string | null = null;
  projectName: string | null = null;

  private routerSub: Subscription;

  constructor(private router: Router, private projectService: ProjectService) {
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(event => {
        const match = event.urlAfterRedirects.match(/\/projects\/(\d+)/);
        const newId = match ? match[1] : null;

        if (newId !== this.projectId) {
          this.projectId = newId;
          this.projectName = null;

          if (newId) {
            this.projectService.getById(+newId).subscribe({
              next: p => this.projectName = p.name,
              error: () => this.projectName = `Project #${newId}`,
            });
          }
        }
      });
  }

  ngOnDestroy() {
    this.routerSub.unsubscribe();
  }
}
