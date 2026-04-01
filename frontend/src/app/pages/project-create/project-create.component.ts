import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { switchMap } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ProjectService } from '../../services/project.service';

@Component({
  selector: 'app-project-create',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatButtonToggleModule,
  ],
  templateUrl: './project-create.component.html',
  styleUrl: './project-create.component.scss'
})
export class ProjectCreateComponent {
  readonly form;

  selectedFile: File | null = null;
  selectedFolderFiles: File[] = [];
  uploadMode: 'zip' | 'folder' = 'zip';
  busy = false;
  error = '';
  stepLabel = 'Ready';

  constructor(
    private readonly fb: FormBuilder,
    private readonly projectService: ProjectService,
    private readonly router: Router,
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.selectedFolderFiles = [];
    this.uploadMode = 'zip';
    this.error = '';
  }

  onFolderSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    this.selectedFolderFiles = files;
    this.selectedFile = null;
    this.uploadMode = 'folder';
    this.error = '';
  }

  canSubmit(): boolean {
    const hasZip = this.uploadMode === 'zip' && !!this.selectedFile;
    const hasFolder = this.uploadMode === 'folder' && this.selectedFolderFiles.length > 0;
    return this.form.valid && (hasZip || hasFolder) && !this.busy;
  }

  createAndAnalyze(): void {
    if (!this.canSubmit()) return;

    this.busy = true;
    this.error = '';
    this.stepLabel = 'Creating project...';

    this.projectService.create(this.form.getRawValue() as { name: string; description?: string })
      .pipe(
        switchMap((project) => {
          this.stepLabel = 'Uploading PBIP ZIP...';
          const uploadRequest = this.uploadMode === 'zip'
            ? this.projectService.upload(project.id, this.selectedFile!)
            : this.projectService.uploadFolder(project.id, this.selectedFolderFiles);

          this.stepLabel = this.uploadMode === 'zip' ? 'Uploading PBIP ZIP...' : 'Uploading PBIP folder...';

          return uploadRequest.pipe(
            switchMap(() => {
              this.stepLabel = 'Running analysis pipeline...';
              return this.projectService.analyze(project.id).pipe(
                switchMap(() => this.projectService.getById(project.id))
              );
            })
          );
        })
      )
      .subscribe({
        next: (project) => {
          this.stepLabel = 'Done';
          this.router.navigate(['/projects', project.id]);
        },
        error: (err) => {
          this.error = err?.error?.error || 'Unexpected error while creating the project.';
          this.busy = false;
        },
      });
  }

}
