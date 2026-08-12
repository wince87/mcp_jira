import type { JiraComponent, JiraProject, JiraVersion, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { present } from '../args.js';
import { fetchProjectId } from '../meta.js';
import { mapComponent, mapProject, mapVersion } from '../mappers.js';
import { offsetPage, offsetParams } from '../args.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateAccountId, validateAssigneeType, validateDate, validateSafeParam } from '../validation.js';
import { defineTool } from '../registry.js';
import { JIRA_PROJECT_KEY } from '../config.js';

export async function handleGetProjectInfo(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}`);
  return createSuccessResponse(mapProject(response.data));
}

export async function handleListProjects(a: ToolArgs): Promise<ToolResponse> {
  const { query } = a;
  const params: Record<string, unknown> = offsetParams(a);
  if (query) params.query = sanitizeString(query, 200, 'query');

  const response = await jiraApi.get('/project/search', { params });
  const projects: JiraProject[] = response.data.values ?? [];
  return createSuccessResponse({
    ...offsetPage(response.data, projects.length, params),
    projects: projects.map(mapProject),
  });
}

export async function handleGetProjectComponents(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}/components`);
  const components: JiraComponent[] = response.data ?? [];
  return createSuccessResponse({
    projectKey,
    components: components.map(mapComponent),
  });
}

export async function handleGetProjectVersions(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}/versions`);
  const versions: JiraVersion[] = response.data ?? [];
  return createSuccessResponse({
    projectKey,
    versions: versions.map(mapVersion),
  });
}

export const GetProjectInfoTool = defineTool({
  name: 'jira_get_project_info',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get project information',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Project key', default: JIRA_PROJECT_KEY },
    },
  },
  handler: handleGetProjectInfo,
});

export const ListProjectsTool = defineTool({
  name: 'jira_list_projects',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'List all accessible Jira projects.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
      query: { type: 'string', description: 'Filter projects by name (partial match)' },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
    },
  },
  handler: handleListProjects,
});

export const GetProjectComponentsTool = defineTool({
  name: 'jira_get_project_components',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get components of a Jira project.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
    },
  },
  handler: handleGetProjectComponents,
});

export const GetProjectVersionsTool = defineTool({
  name: 'jira_get_project_versions',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get versions (releases) of a Jira project.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
    },
  },
  handler: handleGetProjectVersions,
});

export async function handleCreateVersion(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const payload: Record<string, unknown> = {
    name: sanitizeString(a.name, 255, 'name'),
    projectId: Number(await fetchProjectId(projectKey)),
  };
  if (present(a.description)) payload.description = sanitizeString(a.description, 5000, 'description');
  if (present(a.startDate)) payload.startDate = validateDate(a.startDate, 'startDate');
  if (present(a.releaseDate)) payload.releaseDate = validateDate(a.releaseDate, 'releaseDate');
  if (present(a.released)) payload.released = a.released === true;

  const response = await jiraApi.post('/version', payload);
  return createSuccessResponse({ success: true, projectKey, version: mapVersion(response.data) });
}

export async function handleUpdateVersion(a: ToolArgs): Promise<ToolResponse> {
  const versionId = validateSafeParam(a.versionId, 'versionId', 30);
  const payload: Record<string, unknown> = {};
  if (present(a.name)) payload.name = sanitizeString(a.name, 255, 'name');
  if (present(a.description)) payload.description = sanitizeString(a.description, 5000, 'description');
  if (present(a.startDate)) payload.startDate = validateDate(a.startDate, 'startDate');
  if (present(a.releaseDate)) payload.releaseDate = validateDate(a.releaseDate, 'releaseDate');
  if (present(a.released)) payload.released = a.released === true;
  if (present(a.archived)) payload.archived = a.archived === true;
  if (Object.keys(payload).length === 0) {
    throw new Error('Provide at least one of name, description, startDate, releaseDate, released or archived');
  }

  const response = await jiraApi.put(`/version/${versionId}`, payload);
  return createSuccessResponse({ success: true, version: mapVersion(response.data) });
}

export async function handleDeleteVersion(a: ToolArgs): Promise<ToolResponse> {
  const versionId = validateSafeParam(a.versionId, 'versionId', 30);
  const payload: Record<string, unknown> = {};
  if (present(a.moveFixIssuesTo)) payload.moveFixIssuesTo = validateSafeParam(a.moveFixIssuesTo, 'moveFixIssuesTo', 30);
  if (present(a.moveAffectedIssuesTo)) payload.moveAffectedIssuesTo = validateSafeParam(a.moveAffectedIssuesTo, 'moveAffectedIssuesTo', 30);

  await jiraApi.post(`/version/${versionId}/removeAndSwap`, payload);
  return createSuccessResponse({
    success: true,
    message: `Version ${versionId} deleted permanently`,
    movedIssuesTo: payload.moveFixIssuesTo ?? null,
  });
}

export async function handleCreateComponent(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const payload: Record<string, unknown> = {
    name: sanitizeString(a.name, 255, 'name'),
    project: projectKey,
  };
  if (present(a.description)) payload.description = sanitizeString(a.description, 5000, 'description');
  if (present(a.leadAccountId)) payload.leadAccountId = validateAccountId(a.leadAccountId);
  if (present(a.assigneeType)) payload.assigneeType = validateAssigneeType(a.assigneeType);

  const response = await jiraApi.post('/component', payload);
  return createSuccessResponse({ success: true, projectKey, component: mapComponent(response.data) });
}

export async function handleUpdateComponent(a: ToolArgs): Promise<ToolResponse> {
  const componentId = validateSafeParam(a.componentId, 'componentId', 30);
  const payload: Record<string, unknown> = {};
  if (present(a.name)) payload.name = sanitizeString(a.name, 255, 'name');
  if (present(a.description)) payload.description = sanitizeString(a.description, 5000, 'description');
  if (present(a.leadAccountId)) payload.leadAccountId = validateAccountId(a.leadAccountId);
  if (present(a.assigneeType)) payload.assigneeType = validateAssigneeType(a.assigneeType);
  if (Object.keys(payload).length === 0) {
    throw new Error('Provide at least one of name, description, leadAccountId or assigneeType');
  }

  const response = await jiraApi.put(`/component/${componentId}`, payload);
  return createSuccessResponse({ success: true, component: mapComponent(response.data) });
}

export async function handleDeleteComponent(a: ToolArgs): Promise<ToolResponse> {
  const componentId = validateSafeParam(a.componentId, 'componentId', 30);
  const params: Record<string, unknown> = {};
  if (present(a.moveIssuesTo)) params.moveIssuesTo = validateSafeParam(a.moveIssuesTo, 'moveIssuesTo', 30);

  await jiraApi.delete(`/component/${componentId}`, { params });
  return createSuccessResponse({
    success: true,
    message: `Component ${componentId} deleted permanently`,
    movedIssuesTo: params.moveIssuesTo ?? null,
  });
}

export const CreateVersionTool = defineTool({
  name: 'jira_create_version',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Create a project version (release). Versions are what fixVersions and affects versions point at, so create one here instead of sending the user to the Jira UI.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Version name, e.g. "1.4.0"' },
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
      description: { type: 'string', description: 'Version description' },
      startDate: { type: 'string', description: 'Start date as YYYY-MM-DD' },
      releaseDate: { type: 'string', description: 'Release date as YYYY-MM-DD' },
      released: { type: 'boolean', description: 'Mark as already released', default: false },
    },
    required: ['name'],
  },
  handler: handleCreateVersion,
});

export const UpdateVersionTool = defineTool({
  name: 'jira_update_version',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Update a project version. Releasing a version is an update with released set to true (and usually a releaseDate), so there is no separate release tool. Version ids come from jira_get_project_versions.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      versionId: { type: 'string', description: 'Version ID (use jira_get_project_versions)' },
      name: { type: 'string', description: 'New name' },
      description: { type: 'string', description: 'New description' },
      startDate: { type: 'string', description: 'Start date as YYYY-MM-DD' },
      releaseDate: { type: 'string', description: 'Release date as YYYY-MM-DD' },
      released: { type: 'boolean', description: 'Set true to release the version, false to unrelease it' },
      archived: { type: 'boolean', description: 'Archive or unarchive the version' },
    },
    required: ['versionId'],
  },
  handler: handleUpdateVersion,
});

export const DeleteVersionTool = defineTool({
  name: 'jira_delete_version',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description: 'Permanently delete a project version. Issues referencing it keep their other fields, but lose this version unless you pass a replacement. This cannot be undone -- confirm with the user first.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      versionId: { type: 'string', description: 'Version ID to delete' },
      moveFixIssuesTo: { type: 'string', description: 'Version ID to move fixVersion references to. Omit to clear them.' },
      moveAffectedIssuesTo: { type: 'string', description: 'Version ID to move affects-version references to. Omit to clear them.' },
    },
    required: ['versionId'],
  },
  handler: handleDeleteVersion,
});

export const CreateComponentTool = defineTool({
  name: 'jira_create_component',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Create a project component. Components are the values the components field accepts on create and update.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Component name' },
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
      description: { type: 'string', description: 'Component description' },
      leadAccountId: { type: 'string', description: 'Component lead accountId (from jira_search_users)' },
      assigneeType: { type: 'string', enum: ['PROJECT_DEFAULT', 'COMPONENT_LEAD', 'PROJECT_LEAD', 'UNASSIGNED'], description: 'Default assignee rule for issues in this component' },
    },
    required: ['name'],
  },
  handler: handleCreateComponent,
});

export const UpdateComponentTool = defineTool({
  name: 'jira_update_component',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Update a project component. Component ids come from jira_get_project_components.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      componentId: { type: 'string', description: 'Component ID (use jira_get_project_components)' },
      name: { type: 'string', description: 'New name' },
      description: { type: 'string', description: 'New description' },
      leadAccountId: { type: 'string', description: 'New component lead accountId' },
      assigneeType: { type: 'string', enum: ['PROJECT_DEFAULT', 'COMPONENT_LEAD', 'PROJECT_LEAD', 'UNASSIGNED'], description: 'Default assignee rule' },
    },
    required: ['componentId'],
  },
  handler: handleUpdateComponent,
});

export const DeleteComponentTool = defineTool({
  name: 'jira_delete_component',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description: 'Permanently delete a project component. Pass moveIssuesTo to reassign its issues to another component, otherwise they simply lose it. This cannot be undone -- confirm with the user first.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      componentId: { type: 'string', description: 'Component ID to delete' },
      moveIssuesTo: { type: 'string', description: 'Component ID to move issues to. Omit to clear the field on those issues.' },
    },
    required: ['componentId'],
  },
  handler: handleDeleteComponent,
});

export const PROJECTS_TOOLS = [
  CreateVersionTool,
  UpdateVersionTool,
  DeleteVersionTool,
  CreateComponentTool,
  UpdateComponentTool,
  DeleteComponentTool,
  GetProjectInfoTool,
  ListProjectsTool,
  GetProjectComponentsTool,
  GetProjectVersionsTool,
];
