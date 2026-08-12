import type { JiraComment, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { present } from '../args.js';
import { mapComment } from '../mappers.js';
import { offsetPage, offsetParams } from '../args.js';
import { adfToText, createADFDocument } from '../adf.js';
import { createSuccessResponse } from '../responses.js';
import { sanitizeString, validateIssueKey, validateSafeParam } from '../validation.js';
import { defineTool } from '../registry.js';

function commentPayload(a: ToolArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = { body: createADFDocument(a.comment) };

  if (present(a.visibility)) {
    const visibility = a.visibility as Record<string, unknown>;
    const type = sanitizeString(visibility.type, 20, 'visibility.type').toLowerCase();
    if (type !== 'role' && type !== 'group') {
      throw new Error('visibility.type must be "role" or "group"');
    }
    payload.visibility = { type, value: sanitizeString(visibility.value, 255, 'visibility.value') };
  }

  if (a.internal === true) {
    payload.properties = [{ key: 'sd.public.comment', value: { internal: true } }];
  }

  return payload;
}

export async function handleAddComment(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.post(`/issue/${issueKey}/comment`, commentPayload(a));
  return createSuccessResponse({
    success: true,
    message: `Comment added to ${issueKey}`,
    comment: mapComment(response.data),
  });
}

export async function handleUpdateComment(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const commentId = validateSafeParam(a.commentId, 'commentId', 50);
  const response = await jiraApi.put(`/issue/${issueKey}/comment/${commentId}`, commentPayload(a));
  return createSuccessResponse({
    success: true,
    message: `Comment ${commentId} updated on ${issueKey}`,
    comment: mapComment(response.data),
  });
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
    comments: comments.map(mapComment),
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
      visibility: { type: 'object', properties: { type: { type: 'string', enum: ['role', 'group'] }, value: { type: 'string' } }, description: 'Restrict who can read the comment, e.g. { "type": "role", "value": "Administrators" }. Omit to leave it visible to everyone who can see the issue.' },
      internal: { type: 'boolean', description: 'Jira Service Management only: post as an internal note that the customer cannot see.', default: false },
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
      visibility: { type: 'object', properties: { type: { type: 'string', enum: ['role', 'group'] }, value: { type: 'string' } }, description: 'Restrict who can read the comment, e.g. { "type": "role", "value": "Administrators" }. Omit to leave it visible to everyone who can see the issue.' },
      internal: { type: 'boolean', description: 'Jira Service Management only: post as an internal note that the customer cannot see.', default: false },
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
