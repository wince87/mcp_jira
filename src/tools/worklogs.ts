import type { JiraWorklog, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { adfToText, createADFDocument } from '../adf.js';
import { createSuccessResponse } from '../responses.js';
import { sanitizeString, validateISO8601, validateIssueKey, validateSafeParam } from '../validation.js';

export async function handleAddWorklog(a: ToolArgs): Promise<ToolResponse> {
  const { comment, started } = a;
  const issueKey = validateIssueKey(a.issueKey);
  const timeSpent = sanitizeString(a.timeSpent, 50, 'timeSpent');

  const worklogData: Record<string, unknown> = { timeSpent };
  if (comment) worklogData.comment = createADFDocument(comment);
  if (started !== undefined && started !== null) worklogData.started = validateISO8601(started, 'started');

  const response = await jiraApi.post(`/issue/${issueKey}/worklog`, worklogData);
  return createSuccessResponse({ success: true, id: response.data.id, issueKey, timeSpent: response.data.timeSpent, author: response.data.author?.displayName });
}

export async function handleGetWorklogs(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}/worklog`);
  const worklogs: JiraWorklog[] = response.data.worklogs ?? [];
  return createSuccessResponse({
    issueKey,
    total: response.data.total ?? worklogs.length,
    worklogs: worklogs.map(w => ({
      id: w.id,
      author: w.author?.displayName,
      timeSpent: w.timeSpent,
      timeSpentSeconds: w.timeSpentSeconds,
      started: w.started,
      comment: adfToText(w.comment),
    })),
  });
}

export async function handleUpdateWorklog(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const worklogId = validateSafeParam(a.worklogId, 'worklogId', 50);
  const { timeSpent, comment, started } = a;

  const worklogData: Record<string, unknown> = {};
  if (timeSpent !== undefined && timeSpent !== null) {
    worklogData.timeSpent = sanitizeString(timeSpent, 50, 'timeSpent');
  }
  if (comment !== undefined && comment !== null) {
    worklogData.comment = createADFDocument(comment);
  }
  if (started !== undefined && started !== null) {
    worklogData.started = validateISO8601(started, 'started');
  }
  if (Object.keys(worklogData).length === 0) {
    throw new Error('At least one of timeSpent, comment, or started is required');
  }

  const response = await jiraApi.put(`/issue/${issueKey}/worklog/${worklogId}`, worklogData);
  return createSuccessResponse({
    success: true,
    id: response.data.id,
    issueKey,
    timeSpent: response.data.timeSpent,
    started: response.data.started,
  });
}

export async function handleDeleteWorklog(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const worklogId = validateSafeParam(a.worklogId, 'worklogId', 50);
  await jiraApi.delete(`/issue/${issueKey}/worklog/${worklogId}`);
  return createSuccessResponse({ success: true, message: `Worklog ${worklogId} deleted from ${issueKey}` });
}
