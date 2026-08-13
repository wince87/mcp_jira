import type { ToolArgs } from './types.js';
import { sanitizeString, validateMaxResults } from './validation.js';

export function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function readMaxResults(a: ToolArgs, fallback: number = 50): number {
  return validateMaxResults(present(a.maxResults) ? a.maxResults : fallback);
}

export function readStartAt(a: ToolArgs): number | null {
  if (!present(a.startAt)) return null;
  const value = a.startAt;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('startAt must be a non-negative integer');
  }
  return value;
}

export function readPageToken(a: ToolArgs): string | null {
  if (typeof a.nextPageToken !== 'string' || !a.nextPageToken) return null;
  return sanitizeString(a.nextPageToken, 2000, 'nextPageToken');
}

export function numericId(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

export function offsetParams(a: ToolArgs, fallbackMaxResults: number | null = 50): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (fallbackMaxResults !== null || present(a.maxResults)) {
    params.maxResults = readMaxResults(a, fallbackMaxResults ?? 50);
  }
  const startAt = readStartAt(a);
  if (startAt !== null) params.startAt = startAt;
  return params;
}

interface OffsetResponse {
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
}

export function offsetPage(response: OffsetResponse, returned: number, requested: Record<string, unknown>): Record<string, unknown> {
  const startAt = response.startAt ?? (requested.startAt as number | undefined) ?? 0;
  const page: Record<string, unknown> = { returned, startAt };
  if (typeof response.total === 'number') page.total = response.total;
  page.hasMore = response.isLast !== undefined
    ? response.isLast === false
    : typeof response.total === 'number'
      ? startAt + returned < response.total
      : returned >= (requested.maxResults as number);
  return page;
}

export function tokenPage(response: { isLast?: boolean; nextPageToken?: string | null }, returned: number): Record<string, unknown> {
  return {
    returned,
    nextPageToken: response.nextPageToken ?? null,
    hasMore: response.isLast === false || Boolean(response.nextPageToken),
  };
}
