import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { JiraAttachment, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { mapAttachment } from '../mappers.js';
import {
  MAX_INLINE_IMAGE_BYTES, createMixedResponse, createSuccessResponse, imageContent, isImageMime,
} from '../responses.js';
import { sanitizeString, validateAttachmentPath, validateIssueKey, validateSafeParam } from '../validation.js';
import { defineTool } from '../registry.js';

export async function handleGetAttachments(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}`, {
    params: { fields: 'attachment' },
  });

  const attachments: JiraAttachment[] = response.data.fields?.attachment ?? [];

  return createSuccessResponse({
    issueKey,
    total: attachments.length,
    attachments: attachments.map(mapAttachment),
  });
}

export async function handleAddAttachment(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const filePath = sanitizeString(a.filePath, 500, 'filePath');
  const absolutePath = validateAttachmentPath(filePath);
  const fileName = basename(absolutePath);

  const fileBuffer = readFileSync(absolutePath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), fileName);

  const response = await jiraApi.post(`/issue/${issueKey}/attachments`, form, {
    headers: { 'X-Atlassian-Token': 'no-check', 'Content-Type': 'multipart/form-data' },
  });

  const attachments: JiraAttachment[] = response.data ?? [];
  return createSuccessResponse({
    success: true,
    attachments: attachments.map(mapAttachment),
  });
}

export async function handleDownloadAttachment(a: ToolArgs): Promise<ToolResponse> {
  const attachmentId = validateSafeParam(a.attachmentId, 'attachmentId', 50);
  const savePath = sanitizeString(a.savePath, 500, 'savePath');
  const absolutePath = validateAttachmentPath(savePath);

  const metaResponse = await jiraApi.get(`/attachment/${attachmentId}`);
  const meta = metaResponse.data;

  const contentResponse = await jiraApi.get(`/attachment/content/${attachmentId}`, {
    responseType: 'arraybuffer',
  });

  writeFileSync(absolutePath, Buffer.from(contentResponse.data));

  return createSuccessResponse({
    success: true,
    attachmentId,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
    savedTo: absolutePath,
  });
}

export async function handleViewAttachment(a: ToolArgs): Promise<ToolResponse> {
  const attachmentId = validateSafeParam(a.attachmentId, 'attachmentId', 50);

  const metaResponse = await jiraApi.get(`/attachment/${attachmentId}`);
  const meta = metaResponse.data;

  if (!isImageMime(meta.mimeType)) {
    throw new Error(`Attachment ${attachmentId} is not an image (mimeType: ${meta.mimeType ?? 'unknown'}). Use jira_download_attachment for non-image files.`);
  }
  if (typeof meta.size === 'number' && meta.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error(`Image ${attachmentId} is ${meta.size} bytes, exceeds inline limit of ${MAX_INLINE_IMAGE_BYTES}. Use jira_download_attachment instead.`);
  }

  const contentResponse = await jiraApi.get(`/attachment/content/${attachmentId}`, {
    responseType: 'arraybuffer',
  });

  return createMixedResponse(
    { attachmentId, filename: meta.filename, mimeType: meta.mimeType, size: meta.size },
    [imageContent(Buffer.from(contentResponse.data), meta.mimeType)],
  );
}

export const GetAttachmentsTool = defineTool({
  name: 'jira_get_attachments',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get list of attachments on a Jira issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
    },
    required: ['issueKey'],
  },
  handler: handleGetAttachments,
});

export const AddAttachmentTool = defineTool({
  name: 'jira_add_attachment',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Attach a local file to a Jira issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      filePath: { type: 'string', description: 'Absolute path to the file to attach' },
    },
    required: ['issueKey', 'filePath'],
  },
  handler: handleAddAttachment,
});

export const DownloadAttachmentTool = defineTool({
  name: 'jira_download_attachment',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Download an attachment from Jira to a local file. Destination path must be within cwd or user home.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      attachmentId: { type: 'string', description: 'Attachment ID (from jira_get_attachments)' },
      savePath: { type: 'string', description: 'Absolute local path where the file will be written' },
    },
    required: ['attachmentId', 'savePath'],
  },
  handler: handleDownloadAttachment,
});

export const ViewAttachmentTool = defineTool({
  name: 'jira_view_attachment',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Fetch an image attachment and return it inline so the model can see it (no file written). Image attachments only (mimeType image/*), capped at 5MB. For non-images or larger files use jira_download_attachment. Get the attachmentId from jira_get_attachments.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      attachmentId: { type: 'string', description: 'Attachment ID (from jira_get_attachments)' },
    },
    required: ['attachmentId'],
  },
  handler: handleViewAttachment,
});

export async function handleDeleteAttachment(a: ToolArgs): Promise<ToolResponse> {
  const attachmentId = validateSafeParam(a.attachmentId, 'attachmentId', 50);
  await jiraApi.delete(`/attachment/${attachmentId}`);
  return createSuccessResponse({ success: true, message: `Attachment ${attachmentId} deleted permanently` });
}

export const DeleteAttachmentTool = defineTool({
  name: 'jira_delete_attachment',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description: 'Permanently delete an attachment. Attachment ids come from jira_get_attachments. This cannot be undone — confirm with the user first.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      attachmentId: { type: 'string', description: 'Attachment ID (use jira_get_attachments)' },
    },
    required: ['attachmentId'],
  },
  handler: handleDeleteAttachment,
});

export const ATTACHMENTS_TOOLS = [
  DeleteAttachmentTool,
  GetAttachmentsTool,
  AddAttachmentTool,
  DownloadAttachmentTool,
  ViewAttachmentTool,
];
