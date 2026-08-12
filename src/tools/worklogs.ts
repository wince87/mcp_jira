import type { JiraWorklog, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { mapUser, mapWorklog } from '../mappers.js';
import { offsetPage, offsetParams } from '../args.js';
import { adfToText, createADFDocument } from '../adf.js';
import { createSuccessResponse } from '../responses.js';
import { sanitizeString, validateISO8601, validateIssueKey, validateSafeParam } from '../validation.js';
import { defineTool } from '../registry.js';

export async function handleAddWorklog(a: ToolArgs): Promise<ToolResponse> {
  const { comment, started } = a;
  const issueKey = validateIssueKey(a.issueKey);
  const timeSpent = sanitizeString(a.timeSpent, 50, 'timeSpent');

  const worklogData: Record<string, unknown> = { timeSpent };
  if (comment) worklogData.comment = createADFDocument(comment);
  if (started !== undefined && started !== null) worklogData.started = validateISO8601(started, 'started');

  const response = await jiraApi.post(`/issue/${issueKey}/worklog`, worklogData);
  return createSuccessResponse({ success: true, id: response.data.id, issueKey, timeSpent: response.data.timeSpent, author: mapUser(response.data.author) });
}

export async function handleGetWorklogs(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const params = offsetParams(a, null);
  const response = await jiraApi.get(`/issue/${issueKey}/worklog`, { params });
  const worklogs: JiraWorklog[] = response.data.worklogs ?? [];
  return createSuccessResponse({
    issueKey,
    ...offsetPage(response.data, worklogs.length, params),
    worklogs: worklogs.map(mapWorklog),
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

export const AddWorklogTool = defineTool({
  name: 'jira_add_worklog',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Add a worklog entry (time tracking). `timeSpent` uses Jira units: w (week), d (day, 8h by default), h (hour), m (minute). `started` must be ISO 8601 with millisecond and timezone offset, e.g. "2024-01-15T09:00:00.000+0000" (NOT a Z-terminated ISO). If omitted, server uses now.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      timeSpent: { type: 'string', description: 'Jira-style duration. Examples: "2h 30m", "1d", "45m", "3w 2d". Max units w/d/h/m.' },
      comment: { type: 'string', description: 'Worklog comment in Markdown.' },
      started: { type: 'string', description: 'Start time as ISO 8601 with millis and offset, e.g. "2024-01-15T09:00:00.000+0000". Defaults to now.' },
    },
    required: ['issueKey', 'timeSpent'],
  },
  handler: handleAddWorklog,
});

export const GetWorklogsTool = defineTool({
  name: 'jira_get_worklogs',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get worklog entries from a Jira issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., TTC-123)' },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
      maxResults: { type: 'number', description: 'Maximum number of worklog entries (1-100). Omit to let Jira return every entry.' },
    },
    required: ['issueKey'],
  },
  handler: handleGetWorklogs,
});

export const UpdateWorklogTool = defineTool({
  name: 'jira_update_worklog',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Update an existing worklog entry on a Jira issue. All fields except issueKey/worklogId are optional - omit to leave unchanged.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      worklogId: { type: 'string', description: 'Worklog ID (use jira_get_worklogs to find it)' },
      timeSpent: { type: 'string', description: 'New duration in Jira format ("2h 30m", "1d", "45m"). Optional.' },
      comment: { type: 'string', description: 'New comment in Markdown. Optional.' },
      started: { type: 'string', description: 'New start time as ISO 8601 with millis and offset, e.g. "2024-01-15T09:00:00.000+0000". Optional.' },
    },
    required: ['issueKey', 'worklogId'],
  },
  handler: handleUpdateWorklog,
});

export const DeleteWorklogTool = defineTool({
  name: 'jira_delete_worklog',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description: 'Delete a worklog entry from a Jira issue. Permanent.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      worklogId: { type: 'string', description: 'Worklog ID (use jira_get_worklogs to find it)' },
    },
    required: ['issueKey', 'worklogId'],
  },
  handler: handleDeleteWorklog,
});

export const WORKLOGS_TOOLS = [
  AddWorklogTool,
  GetWorklogsTool,
  UpdateWorklogTool,
  DeleteWorklogTool,
];
