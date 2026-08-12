import type { JiraUser, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { offsetPage, offsetParams } from '../args.js';
import { createSuccessResponse } from '../responses.js';
import { sanitizeString, validateAccountId, validateIssueKey } from '../validation.js';
import { defineTool } from '../registry.js';

export async function handleSearchUsers(a: ToolArgs): Promise<ToolResponse> {
  const query = sanitizeString(a.query, 200, 'query');
  const params = { ...offsetParams(a, 10), query };
  const response = await jiraApi.get('/user/search', { params });
  const users: JiraUser[] = response.data ?? [];
  return createSuccessResponse({
    ...offsetPage({}, users.length, params),
    users: users.map(u => ({ accountId: u.accountId, displayName: u.displayName, emailAddress: u.emailAddress, active: u.active, accountType: u.accountType })),
  });
}

export async function handleGetMyself(_a: ToolArgs): Promise<ToolResponse> {
  const response = await jiraApi.get('/myself');
  const u = response.data;
  return createSuccessResponse({
    accountId: u.accountId,
    displayName: u.displayName,
    email: u.emailAddress,
    active: u.active,
    timeZone: u.timeZone,
    locale: u.locale,
    accountType: u.accountType,
  });
}

export async function handleAddWatcher(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const accountId = a.accountId === undefined || a.accountId === null
    ? null
    : validateAccountId(a.accountId);
  await jiraApi.post(`/issue/${issueKey}/watchers`, accountId ?? '');
  return createSuccessResponse({ success: true, issueKey, accountId: accountId ?? 'self' });
}

export async function handleRemoveWatcher(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const accountId = validateAccountId(a.accountId);
  await jiraApi.delete(`/issue/${issueKey}/watchers`, { params: { accountId } });
  return createSuccessResponse({ success: true, issueKey, accountId });
}

export async function handleGetWatchers(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}/watchers`);
  interface WatcherUser { accountId: string; displayName: string; active?: boolean }
  const watchers: WatcherUser[] = response.data.watchers ?? [];
  return createSuccessResponse({
    issueKey,
    isWatching: response.data.isWatching,
    watchCount: response.data.watchCount ?? watchers.length,
    watchers: watchers.map(w => ({
      accountId: w.accountId,
      displayName: w.displayName,
      active: w.active ?? true,
    })),
  });
}

export const SearchUsersTool = defineTool({
  name: 'jira_search_users',
  description: 'Search for Jira users by name or email. Returns accountId needed for jira_assign_issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query (matches display name and email prefix)' },
      maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 10 },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
    },
    required: ['query'],
  },
  handler: handleSearchUsers,
});

export const GetMyselfTool = defineTool({
  name: 'jira_get_myself',
  description: 'Get the authenticated user (accountId, displayName, email, timezone, locale). Useful to know who the MCP server is acting as.',
  inputSchema: { type: 'object' as const, properties: {} },
  handler: handleGetMyself,
});

export const AddWatcherTool = defineTool({
  name: 'jira_add_watcher',
  description: 'Subscribe a user to watch an issue (receive notifications on changes).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      accountId: { type: 'string', description: 'Atlassian accountId of the user to add as watcher. Omit to add the authenticated user.' },
    },
    required: ['issueKey'],
  },
  handler: handleAddWatcher,
});

export const RemoveWatcherTool = defineTool({
  name: 'jira_remove_watcher',
  description: 'Unsubscribe a user from watching an issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key' },
      accountId: { type: 'string', description: 'Atlassian accountId to remove. Required.' },
    },
    required: ['issueKey', 'accountId'],
  },
  handler: handleRemoveWatcher,
});

export const GetWatchersTool = defineTool({
  name: 'jira_get_watchers',
  description: 'List all watchers on an issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key' },
    },
    required: ['issueKey'],
  },
  handler: handleGetWatchers,
});

export const USERS_TOOLS = [
  SearchUsersTool,
  GetMyselfTool,
  AddWatcherTool,
  RemoveWatcherTool,
  GetWatchersTool,
];
