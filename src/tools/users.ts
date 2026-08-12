import type { JiraUser, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { readMaxResults } from '../args.js';
import { createSuccessResponse } from '../responses.js';
import { sanitizeString, validateAccountId, validateIssueKey, validateMaxResults } from '../validation.js';

export async function handleSearchUsers(a: ToolArgs): Promise<ToolResponse> {
  const query = sanitizeString(a.query, 200, 'query');
  const response = await jiraApi.get('/user/search', { params: { query, maxResults: readMaxResults(a, 10) } });
  const users: JiraUser[] = response.data ?? [];
  return createSuccessResponse({
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
