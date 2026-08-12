import type { JiraIssue, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { buildJql, equalsClause } from '../jql.js';
import { readMaxResults } from '../args.js';
import { createIssueUrl, createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateAccountId, validateJQL, validateMaxResults } from '../validation.js';

export async function handleSearchIssues(a: ToolArgs): Promise<ToolResponse> {
  const { nextPageToken } = a;
  const jql = validateJQL(a.jql);

  const params: Record<string, unknown> = {
    jql,
    maxResults: readMaxResults(a),
    fields: 'summary,status,assignee,priority,created,updated,issuetype,parent,labels',
  };
  if (nextPageToken) params.nextPageToken = nextPageToken;

  const response = await jiraApi.get('/search/jql', { params });

  const issues: JiraIssue[] = response.data.issues ?? [];
  return createSuccessResponse({
    count: issues.length,
    isLast: response.data.isLast ?? true,
    nextPageToken: response.data.nextPageToken ?? null,
    issues: issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      assignee: issue.fields.assignee ? { displayName: issue.fields.assignee.displayName, accountId: issue.fields.assignee.accountId } : null,
      priority: issue.fields.priority?.name,
      issueType: issue.fields.issuetype?.name,
      labels: issue.fields.labels || [],
      parent: issue.fields.parent?.key,
      url: createIssueUrl(issue.key),
    })),
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

  const response = await jiraApi.get('/search/jql', {
    params: {
      jql,
      maxResults: readMaxResults(a),
      fields: 'summary,status,priority,created,updated,issuetype,labels',
    },
  });

  const userIssues: JiraIssue[] = response.data.issues ?? [];
  return createSuccessResponse({
    count: userIssues.length,
    isLast: response.data.isLast ?? true,
    nextPageToken: response.data.nextPageToken ?? null,
    issues: userIssues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      priority: issue.fields.priority?.name,
      issueType: issue.fields.issuetype?.name,
      labels: issue.fields.labels || [],
      updated: issue.fields.updated,
      url: createIssueUrl(issue.key),
    })),
  });
}
