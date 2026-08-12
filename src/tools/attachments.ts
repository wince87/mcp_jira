import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { JiraAttachment, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import {
  MAX_INLINE_IMAGE_BYTES, createMixedResponse, createSuccessResponse, imageContent, isImageMime,
} from '../responses.js';
import { sanitizeString, validateAttachmentPath, validateIssueKey, validateSafeParam } from '../validation.js';

export async function handleGetAttachments(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}`, {
    params: { fields: 'attachment' },
  });

  const attachments: JiraAttachment[] = response.data.fields?.attachment ?? [];

  return createSuccessResponse({
    issueKey,
    total: attachments.length,
    attachments: attachments.map(att => ({
      id: att.id,
      filename: att.filename,
      size: att.size,
      mimeType: att.mimeType,
      created: att.created,
      author: att.author?.displayName,
      url: att.content,
    })),
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
    attachments: attachments.map(att => ({
      id: att.id,
      filename: att.filename,
      size: att.size,
      mimeType: att.mimeType,
      url: att.content,
    })),
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
