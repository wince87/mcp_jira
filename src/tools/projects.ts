import type { JiraComponent, JiraProject, JiraVersion, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { readMaxResults } from '../args.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateMaxResults } from '../validation.js';

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
  const params: Record<string, unknown> = { maxResults: readMaxResults(a) };
  if (query) params.query = sanitizeString(query, 200, 'query');

  const response = await jiraApi.get('/project/search', { params });
  const projects: JiraProject[] = response.data.values ?? [];
  return createSuccessResponse({
    total: response.data.total ?? projects.length,
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
