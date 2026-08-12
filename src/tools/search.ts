import type { JiraIssue, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { readMaxResults, readPageToken, tokenPage } from '../args.js';
import { ISSUE_LIST_FIELDS, mapIssueSummary } from '../mappers.js';
import { buildJql, equalsClause } from '../jql.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { validateAccountId, validateJQL } from '../validation.js';

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
