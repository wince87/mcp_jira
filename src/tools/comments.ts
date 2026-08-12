import type { JiraComment, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { readMaxResults } from '../args.js';
import { adfToText, createADFDocument } from '../adf.js';
import { createSuccessResponse } from '../responses.js';
import { validateIssueKey, validateMaxResults, validateSafeParam } from '../validation.js';

export async function handleAddComment(a: ToolArgs): Promise<ToolResponse> {
  validateIssueKey(a.issueKey);
  await jiraApi.post(`/issue/${a.issueKey}/comment`, { body: createADFDocument(a.comment) });
  return createSuccessResponse({ success: true, message: `Comment added to ${a.issueKey}` });
}

export async function handleUpdateComment(a: ToolArgs): Promise<ToolResponse> {
  validateIssueKey(a.issueKey);
  validateSafeParam(a.commentId, 'commentId', 50);
  await jiraApi.put(`/issue/${a.issueKey}/comment/${a.commentId}`, { body: createADFDocument(a.comment) });
  return createSuccessResponse({ success: true, message: `Comment ${a.commentId} updated on ${a.issueKey}` });
}

export async function handleDeleteComment(a: ToolArgs): Promise<ToolResponse> {
  validateIssueKey(a.issueKey);
  validateSafeParam(a.commentId, 'commentId', 50);
  await jiraApi.delete(`/issue/${a.issueKey}/comment/${a.commentId}`);
  return createSuccessResponse({ success: true, message: `Comment ${a.commentId} deleted from ${a.issueKey}` });
}

export async function handleGetComments(a: ToolArgs): Promise<ToolResponse> {
  const { orderBy = '-created' } = a;
  const issueKey = validateIssueKey(a.issueKey);

  const validatedOrderBy = orderBy === 'created' ? 'created' : '-created';
  const response = await jiraApi.get(`/issue/${issueKey}/comment`, { params: { maxResults: readMaxResults(a), orderBy: validatedOrderBy } });
  const comments: JiraComment[] = response.data.comments ?? [];
  return createSuccessResponse({
    issueKey,
    total: response.data.total ?? comments.length,
    comments: comments.map(c => ({
      id: c.id,
      author: c.author?.displayName,
      body: adfToText(c.body),
      created: c.created,
      updated: c.updated,
    })),
  });
}
