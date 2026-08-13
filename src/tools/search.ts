import type { ToolArgs, ToolResponse } from '../types.js';
import { runJqlSearch } from '../mappers.js';
import { buildJql, equalsClause } from '../jql.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { validateAccountId, validateJQL } from '../validation.js';
import { defineTool } from '../registry.js';
import { ISSUE_LIST_OUTPUT } from '../outputs.js';

export async function handleSearchIssues(a: ToolArgs): Promise<ToolResponse> {
  const jql = validateJQL(a.jql);
  return createSuccessResponse(await runJqlSearch(jql, a));
}

export async function handleGetUserIssues(a: ToolArgs): Promise<ToolResponse> {
  const { status } = a;
  const accountId = validateAccountId(a.accountId);
  const projectKey = resolveProjectKey(a);

  const jql = buildJql({
    clauses: [
      equalsClause('project', projectKey, 'projectKey'),
      equalsClause('assignee', accountId, 'accountId'),
      status ? equalsClause('status', status, 'status') : '',
    ],
    orderBy: 'updated DESC',
  });

  return createSuccessResponse(await runJqlSearch(jql, a));
}

export const SearchIssuesTool = defineTool({
  name: 'jira_search_issues',
  outputSchema: ISSUE_LIST_OUTPUT,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Search for Jira issues using JQL. Uses token-based pagination — pass nextPageToken from previous response to get next page.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      jql: { type: 'string', description: 'JQL query string' },
      nextPageToken: { type: 'string', description: 'Pagination token from previous search response' },
      maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
      fields: { type: 'array', items: { type: 'string' }, description: 'Exact field IDs to return per issue, e.g. ["summary", "customfield_10122"] or ["*all"]. When set, each item returns a raw fields map instead of the default shape.' },
      includeCustomFields: { type: 'boolean', description: 'Add a customFields map (id -> { name, type, value }) to every issue. Rich-text fields render as Markdown. Requests all fields, so prefer an explicit fields list on large result sets.', default: false },
      expand: { type: 'array', items: { type: 'string' }, description: 'Jira expand names, e.g. ["changelog", "renderedFields"].' },
    },
    required: ['jql'],
  },
  handler: handleSearchIssues,
});

export const GetUserIssuesTool = defineTool({
  name: 'jira_get_user_issues',
  outputSchema: ISSUE_LIST_OUTPUT,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get all issues assigned to a specific user.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      accountId: { type: 'string', description: 'Atlassian account ID of the user' },
      projectKey: { type: 'string', description: 'Filter by project key (defaults to configured JIRA_PROJECT_KEY)' },
      maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
      status: { type: 'string', description: 'Filter by status (e.g., "In Progress")' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Exact field IDs to return per issue, e.g. ["summary", "customfield_10122"] or ["*all"]. When set, each item returns a raw fields map instead of the default shape.' },
      includeCustomFields: { type: 'boolean', description: 'Add a customFields map (id -> { name, type, value }) to every issue. Rich-text fields render as Markdown. Requests all fields, so prefer an explicit fields list on large result sets.', default: false },
    },
    required: ['accountId'],
  },
  handler: handleGetUserIssues,
});

export const SEARCH_TOOLS = [
  SearchIssuesTool,
  GetUserIssuesTool,
];
