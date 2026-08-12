import type { JiraComment, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { offsetPage, offsetParams } from '../args.js';
import { adfToText, createADFDocument } from '../adf.js';
import { createSuccessResponse } from '../responses.js';
import { validateIssueKey, validateSafeParam } from '../validation.js';
import { defineTool } from '../registry.js';

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
  const params = { ...offsetParams(a), orderBy: validatedOrderBy };
  const response = await jiraApi.get(`/issue/${issueKey}/comment`, { params });
  const comments: JiraComment[] = response.data.comments ?? [];
  return createSuccessResponse({
    issueKey,
    ...offsetPage(response.data, comments.length, params),
    comments: comments.map(c => ({
      id: c.id,
      author: c.author?.displayName,
      body: adfToText(c.body),
      created: c.created,
      updated: c.updated,
    })),
  });
}

export const AddCommentTool = defineTool({
  name: 'jira_add_comment',
  description: 'Add a comment to a Jira issue. Supports standard Markdown, automatically converted to ADF.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key' },
      comment: { type: 'string', description: 'Comment text in Markdown.' },
    },
    required: ['issueKey', 'comment'],
  },
  handler: handleAddComment,
});

export const UpdateCommentTool = defineTool({
  name: 'jira_update_comment',
  description: 'Update an existing comment on a Jira issue. Supports standard Markdown, automatically converted to ADF.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      commentId: { type: 'string', description: 'Comment ID (use jira_get_comments to find it)' },
      comment: { type: 'string', description: 'Updated comment text in Markdown.' },
    },
    required: ['issueKey', 'commentId', 'comment'],
  },
  handler: handleUpdateComment,
});

export const DeleteCommentTool = defineTool({
  name: 'jira_delete_comment',
  description: 'Delete a comment from a Jira issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      commentId: { type: 'string', description: 'Comment ID (use jira_get_comments to find it)' },
    },
    required: ['issueKey', 'commentId'],
  },
  handler: handleDeleteComment,
});

export const GetCommentsTool = defineTool({
  name: 'jira_get_comments',
  description: 'Get comments from a Jira issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., TTC-123)' },
      maxResults: { type: 'number', description: 'Maximum number of comments (1-100)', default: 50 },
      orderBy: { type: 'string', description: 'Order by created date: "created" (oldest first) or "-created" (newest first)', default: '-created' },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
    },
    required: ['issueKey'],
  },
  handler: handleGetComments,
});

export const COMMENTS_TOOLS = [
  AddCommentTool,
  UpdateCommentTool,
  DeleteCommentTool,
  GetCommentsTool,
];
