import type { JiraIssue, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { offsetPage, offsetParams, readMaxResults, readPageToken, tokenPage } from '../args.js';
import { ISSUE_LIST_FIELDS, mapIssueSummary } from '../mappers.js';
import { createSuccessResponse } from '../responses.js';
import { sanitizeString, validateAccountId, validateSafeParam } from '../validation.js';

export async function handleListFilters(a: ToolArgs): Promise<ToolResponse> {
  const { filterName, accountId, maxResults = 50 } = a;

  const params: Record<string, unknown> = { ...offsetParams(a), expand: 'description,jql,owner' };
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
    ...offsetPage(response.data, filters.length, params),
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

  const params: Record<string, unknown> = { jql, maxResults: readMaxResults(a), fields: ISSUE_LIST_FIELDS };
  const pageToken = readPageToken(a);
  if (pageToken) params.nextPageToken = pageToken;

  const response = await jiraApi.get('/search/jql', { params });
  const issues: JiraIssue[] = response.data.issues ?? [];

  return createSuccessResponse({
    filterId,
    filterName: filterResponse.data.name,
    jql,
    ...tokenPage(response.data, issues.length),
    issues: issues.map(mapIssueSummary),
  });
}
