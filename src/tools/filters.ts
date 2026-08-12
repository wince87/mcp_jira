import type { JiraIssue, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { readMaxResults } from '../args.js';
import { createIssueUrl, createSuccessResponse } from '../responses.js';
import { sanitizeString, validateAccountId, validateMaxResults, validateSafeParam } from '../validation.js';

export async function handleListFilters(a: ToolArgs): Promise<ToolResponse> {
  const { filterName, accountId, maxResults = 50 } = a;

  const params: Record<string, unknown> = { maxResults: readMaxResults(a), expand: 'description,jql,owner' };
  if (filterName !== undefined && filterName !== null) {
    params.filterName = sanitizeString(filterName, 200, 'filterName');
  }
  if (accountId !== undefined && accountId !== null) {
    params.accountId = validateAccountId(accountId);
  }

  const response = await jiraApi.get('/filter/search', { params });
  interface JiraFilter { id: string; name: string; description?: string; jql?: string; owner?: { accountId: string; displayName: string }; favourite?: boolean; favouritedCount?: number }
  const filters: JiraFilter[] = response.data.values ?? [];

  return createSuccessResponse({
    total: response.data.total ?? filters.length,
    isLast: response.data.isLast ?? true,
    filters: filters.map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      jql: f.jql,
      owner: f.owner ? { accountId: f.owner.accountId, displayName: f.owner.displayName } : null,
      favourite: f.favourite ?? false,
      favouritedCount: f.favouritedCount ?? 0,
    })),
  });
}

export async function handleGetFilter(a: ToolArgs): Promise<ToolResponse> {
  const filterId = validateSafeParam(a.filterId, 'filterId', 30);
  const response = await jiraApi.get(`/filter/${filterId}`);
  const f = response.data;
  return createSuccessResponse({
    id: f.id,
    name: f.name,
    description: f.description,
    jql: f.jql,
    owner: f.owner ? { accountId: f.owner.accountId, displayName: f.owner.displayName } : null,
    favourite: f.favourite ?? false,
    favouritedCount: f.favouritedCount ?? 0,
    viewUrl: f.viewUrl,
  });
}

export async function handleSearchByFilter(a: ToolArgs): Promise<ToolResponse> {
  const filterId = validateSafeParam(a.filterId, 'filterId', 30);
  const { nextPageToken } = a;

  const filterResponse = await jiraApi.get(`/filter/${filterId}`);
  const jql: string = filterResponse.data.jql;
  if (!jql || typeof jql !== 'string') throw new Error(`Filter ${filterId} has no JQL`);

  const params: Record<string, unknown> = {
    jql,
    maxResults: readMaxResults(a),
    fields: 'summary,status,assignee,priority,created,updated,issuetype,labels',
  };
  if (typeof nextPageToken === 'string' && nextPageToken) params.nextPageToken = nextPageToken;

  const response = await jiraApi.get('/search/jql', { params });
  const issues: JiraIssue[] = response.data.issues ?? [];

  return createSuccessResponse({
    filterId,
    filterName: filterResponse.data.name,
    jql,
    count: issues.length,
    isLast: response.data.isLast ?? true,
    nextPageToken: response.data.nextPageToken ?? null,
    issues: issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      assignee: issue.fields.assignee?.displayName ?? null,
      priority: issue.fields.priority?.name,
      issueType: issue.fields.issuetype?.name,
      labels: issue.fields.labels || [],
      url: createIssueUrl(issue.key),
    })),
  });
}
