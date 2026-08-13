import type { JiraFilter, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { offsetPage, offsetParams, present } from '../args.js';
import { mapFilter, runJqlSearch } from '../mappers.js';
import { createSuccessResponse } from '../responses.js';
import { sanitizeString, validateAccountId, validateSafeParam } from '../validation.js';
import { defineTool } from '../registry.js';
import { ISSUE_LIST_OUTPUT } from '../outputs.js';

export async function handleListFilters(a: ToolArgs): Promise<ToolResponse> {
  const { filterName, accountId } = a;

  const params: Record<string, unknown> = { ...offsetParams(a), expand: 'description,jql,owner' };
  if (present(filterName)) {
    params.filterName = sanitizeString(filterName, 200, 'filterName');
  }
  if (present(accountId)) {
    params.accountId = validateAccountId(accountId);
  }

  const response = await jiraApi.get('/filter/search', { params });
  const filters: JiraFilter[] = response.data.values ?? [];

  return createSuccessResponse({
    ...offsetPage(response.data, filters.length, params),
    filters: filters.map(mapFilter),
  });
}

export async function handleGetFilter(a: ToolArgs): Promise<ToolResponse> {
  const filterId = validateSafeParam(a.filterId, 'filterId', 30);
  const response = await jiraApi.get(`/filter/${filterId}`);
  return createSuccessResponse(mapFilter(response.data));
}

export async function handleSearchByFilter(a: ToolArgs): Promise<ToolResponse> {
  const filterId = validateSafeParam(a.filterId, 'filterId', 30);

  const filterResponse = await jiraApi.get(`/filter/${filterId}`);
  const jql: unknown = filterResponse.data.jql;
  if (!jql || typeof jql !== 'string') throw new Error(`Filter ${filterId} has no JQL`);

  return createSuccessResponse(await runJqlSearch(jql, a, 'issues', {
    filterId,
    filterName: filterResponse.data.name,
    jql,
  }));
}

export const ListFiltersTool = defineTool({
  name: 'jira_list_filters',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  outputSchema: ISSUE_LIST_OUTPUT,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: "Execute a saved filter's JQL and return matching issues.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      filterId: { type: 'string', description: 'Numeric filter ID' },
      maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
      nextPageToken: { type: 'string', description: 'Pagination token from previous response' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Exact field IDs to return per issue, e.g. ["summary", "customfield_10122"] or ["*all"]. When set, each item returns a raw fields map instead of the default shape.' },
      includeCustomFields: { type: 'boolean', description: 'Add a customFields map (id -> { name, type, value }) to every issue. Rich-text fields render as Markdown. Requests all fields, so prefer an explicit fields list on large result sets.', default: false },
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
