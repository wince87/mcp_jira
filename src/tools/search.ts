import type { JiraIssue, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { createIssueUrl, createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateAccountId, validateJQL, validateMaxResults } from '../validation.js';

export async function handleSearchIssues(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 50, nextPageToken } = a;
  const jql = validateJQL(a.jql);
  const validatedMaxResults = validateMaxResults(maxResults);

  const params: Record<string, unknown> = {
    jql,
    maxResults: validatedMaxResults,
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
  const { maxResults = 50, status } = a;
  const accountId = validateAccountId(a.accountId);
  const validatedMaxResults = validateMaxResults(maxResults);
  const projectKey = resolveProjectKey(a);

  const escapedStatus = status ? sanitizeString(status, 100, 'status').replace(/"/g, '\\"') : null;
  let jql = `project = "${projectKey}" AND assignee = "${accountId}"`;
  if (escapedStatus) jql += ` AND status = "${escapedStatus}"`;
  jql += ' ORDER BY updated DESC';

  const response = await jiraApi.get('/search/jql', {
    params: {
      jql,
      maxResults: validatedMaxResults,
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
