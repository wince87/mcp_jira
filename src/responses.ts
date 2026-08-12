import type { ImageContent, ToolResponse } from './types.js';
import { JIRA_PROJECT_KEY, JIRA_URL } from './config.js';
import { validateProjectKey } from './validation.js';

export function createSuccessResponse(data: unknown): ToolResponse {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2),
    }],
  };
}

export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

export function isImageMime(mimeType: unknown): boolean {
  return typeof mimeType === 'string' && mimeType.startsWith('image/');
}

export function imageContent(buffer: Buffer, mimeType: string): ImageContent {
  return {
    type: 'image',
    data: buffer.toString('base64'),
    mimeType,
  };
}

export function createMixedResponse(data: unknown, images: ImageContent[]): ToolResponse {
  return {
    content: [
      { type: 'text', text: JSON.stringify(data, null, 2) },
      ...images,
    ],
  };
}

export function createIssueUrl(issueKey: string): string {
  return `${JIRA_URL}/browse/${issueKey}`;
}

export function resolveProjectKey(a: Record<string, unknown>): string {
  return a?.projectKey ? validateProjectKey(a.projectKey) : JIRA_PROJECT_KEY;
}
