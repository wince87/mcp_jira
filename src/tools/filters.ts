import type { JiraIssue, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { offsetPage, offsetParams, readMaxResults, readPageToken, tokenPage } from '../args.js';
import { ISSUE_LIST_FIELDS, mapIssueSummary } from '../mappers.js';
import { createSuccessResponse } from '../responses.js';
import { sanitizeString, validateAccountId, validateSafeParam } from '../validation.js';
import { defineTool } from '../registry.js';

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

export const ListFiltersTool = defineTool({
  name: 'jira_list_filters',
  description: 'Search saved Jira filters (by name, owner). Useful to retrieve team-defined JQL queries.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      filterName: { type: 'string', description: 'Substring to match in filter name' },
      accountId: { type: 'string', description: 'Filter owner accountId (defaults to authenticated user if both name and accountId omitted)' },
      maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
    },
  },
  handler: handleListFilters,
});

export const GetFilterTool = defineTool({
  name: 'jira_get_filter',
  description: 'Get a saved filter by ID, including its JQL, description, and owner.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      filterId: { type: 'string', description: 'Numeric filter ID' },
    },
    required: ['filterId'],
  },
  handler: handleGetFilter,
});

export const SearchByFilterTool = defineTool({
  name: 'jira_search_by_filter',
  description: "Execute a saved filter's JQL and return matching issues.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      filterId: { type: 'string', description: 'Numeric filter ID' },
      maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
      nextPageToken: { type: 'string', description: 'Pagination token from previous response' },
    },
    required: ['filterId'],
  },
  handler: handleSearchByFilter,
});

export const FILTERS_TOOLS = [
  ListFiltersTool,
  GetFilterTool,
  SearchByFilterTool,
];
