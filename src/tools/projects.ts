import type { JiraComponent, JiraProject, JiraVersion, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { offsetPage, offsetParams } from '../args.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString } from '../validation.js';
import { defineTool } from '../registry.js';
import { JIRA_PROJECT_KEY } from '../config.js';

export async function handleGetProjectInfo(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}`);
  return createSuccessResponse({
    key: response.data.key,
    name: response.data.name,
    description: response.data.description,
    lead: response.data.lead?.displayName,
    url: response.data.url,
  });
}

export async function handleListProjects(a: ToolArgs): Promise<ToolResponse> {
  const { query } = a;
  const params: Record<string, unknown> = offsetParams(a);
  if (query) params.query = sanitizeString(query, 200, 'query');

  const response = await jiraApi.get('/project/search', { params });
  const projects: JiraProject[] = response.data.values ?? [];
  return createSuccessResponse({
    ...offsetPage(response.data, projects.length, params),
    projects: projects.map(p => ({ key: p.key, name: p.name, projectTypeKey: p.projectTypeKey, style: p.style, lead: p.lead?.displayName })),
  });
}

export async function handleGetProjectComponents(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}/components`);
  const components: JiraComponent[] = response.data ?? [];
  return createSuccessResponse({
    projectKey,
    components: components.map(c => ({ id: c.id, name: c.name, description: c.description, lead: c.lead?.displayName, assigneeType: c.assigneeType })),
  });
}

export async function handleGetProjectVersions(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}/versions`);
  const versions: JiraVersion[] = response.data ?? [];
  return createSuccessResponse({
    projectKey,
    versions: versions.map(v => ({ id: v.id, name: v.name, description: v.description, released: v.released, archived: v.archived, releaseDate: v.releaseDate, startDate: v.startDate })),
  });
}

export const GetProjectInfoTool = defineTool({
  name: 'jira_get_project_info',
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
  description: 'Get versions (releases) of a Jira project.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
    },
  },
  handler: handleGetProjectVersions,
});

export const PROJECTS_TOOLS = [
  GetProjectInfoTool,
  ListProjectsTool,
  GetProjectComponentsTool,
  GetProjectVersionsTool,
];
