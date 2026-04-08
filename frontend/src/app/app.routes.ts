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
		redirectTo: 'projects/:id/audit/overview',
	},
	{
		path: 'projects/:id/audit/overview',
		loadComponent: () => import('./pages/project-overview/project-overview.component').then((m) => m.ProjectOverviewComponent),
	},
	{
		path: 'projects/:id/audit/model',
		loadComponent: () => import('./pages/bpa-violations/bpa-violations.component').then((m) => m.BpaViolationsComponent),
	},
	{
		path: 'projects/:id/audit/visual',
		loadComponent: () => import('./pages/inspector-results/inspector-results.component').then((m) => m.InspectorResultsComponent),
	},
	{
		path: 'projects/:id/audit/optimization',
		loadComponent: () => import('./pages/optimization-audit/optimization-audit.component').then((m) => m.OptimizationAuditComponent),
	},
	{
		path: 'projects/:id/documentation',
		loadComponent: () => import('./pages/model-catalog/model-catalog.component').then((m) => m.ModelCatalogComponent),
	},
	{
		path: 'projects/:id/documentation/visuals',
		loadComponent: () => import('./pages/visual-explorer/visual-explorer.component').then((m) => m.VisualExplorerComponent),
	},

	// Backward-compatible legacy paths
	{
		path: 'projects/:id/bpa',
		redirectTo: 'projects/:id/audit/model',
	},
	{
		path: 'projects/:id/inspector',
		redirectTo: 'projects/:id/audit/visual',
	},
	{
		path: 'projects/:id/catalog',
		redirectTo: 'projects/:id/documentation',
	},
	{ path: '**', redirectTo: 'projects' },
];
