import type { JiraIssue, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { readMaxResults, readPageToken, tokenPage } from '../args.js';
import { ISSUE_LIST_FIELDS, mapIssueSummary } from '../mappers.js';
import { buildJql, equalsClause } from '../jql.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { validateAccountId, validateJQL } from '../validation.js';
import { defineTool } from '../registry.js';
import { JIRA_PROJECT_KEY } from '../config.js';

export async function handleSearchIssues(a: ToolArgs): Promise<ToolResponse> {
  const { nextPageToken } = a;
  const jql = validateJQL(a.jql);

  const params: Record<string, unknown> = {
    jql,
    maxResults: readMaxResults(a),
    fields: ISSUE_LIST_FIELDS,
  };
  const pageToken = readPageToken(a);
  if (pageToken) params.nextPageToken = pageToken;

  const response = await jiraApi.get('/search/jql', { params });

  const issues: JiraIssue[] = response.data.issues ?? [];
  return createSuccessResponse({
    ...tokenPage(response.data, issues.length),
    issues: issues.map(mapIssueSummary),
  });
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

  const params: Record<string, unknown> = { jql, maxResults: readMaxResults(a), fields: ISSUE_LIST_FIELDS };
  const pageToken = readPageToken(a);
  if (pageToken) params.nextPageToken = pageToken;

  const response = await jiraApi.get('/search/jql', { params });

  const userIssues: JiraIssue[] = response.data.issues ?? [];
  return createSuccessResponse({
    ...tokenPage(response.data, userIssues.length),
    issues: userIssues.map(mapIssueSummary),
  });
}

export const SearchIssuesTool = defineTool({
  name: 'jira_search_issues',
  description: 'Search for Jira issues using JQL. Uses token-based pagination — pass nextPageToken from previous response to get next page.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      jql: { type: 'string', description: 'JQL query string' },
      nextPageToken: { type: 'string', description: 'Pagination token from previous search response' },
      maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
    },
    required: ['jql'],
  },
  handler: handleSearchIssues,
});

export const GetUserIssuesTool = defineTool({
  name: 'jira_get_user_issues',
  description: 'Get all issues assigned to a specific user.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      accountId: { type: 'string', description: 'Atlassian account ID of the user' },
      projectKey: { type: 'string', description: 'Filter by project key (defaults to configured JIRA_PROJECT_KEY)' },
      maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
      status: { type: 'string', description: 'Filter by status (e.g., "In Progress")' },
    },
    required: ['accountId'],
  },
  handler: handleGetUserIssues,
});

export const SEARCH_TOOLS = [
  SearchIssuesTool,
  GetUserIssuesTool,
];
