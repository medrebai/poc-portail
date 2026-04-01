import { Routes } from '@angular/router';

export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'projects' },
	{
		path: 'projects',
		loadComponent: () => import('./pages/project-list/project-list.component').then((m) => m.ProjectListComponent),
	},
	{
		path: 'projects/new',
		loadComponent: () => import('./pages/project-create/project-create.component').then((m) => m.ProjectCreateComponent),
	},
	{
		path: 'projects/:id',
		loadComponent: () => import('./pages/project-overview/project-overview.component').then((m) => m.ProjectOverviewComponent),
	},
	{
		path: 'projects/:id/catalog',
		loadComponent: () => import('./pages/model-catalog/model-catalog.component').then((m) => m.ModelCatalogComponent),
	},
	{
		path: 'projects/:id/bpa',
		loadComponent: () => import('./pages/bpa-violations/bpa-violations.component').then((m) => m.BpaViolationsComponent),
	},
	{
		path: 'projects/:id/inspector',
		loadComponent: () => import('./pages/inspector-results/inspector-results.component').then((m) => m.InspectorResultsComponent),
	},
	{ path: '**', redirectTo: 'projects' },
];
