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

export function optionalText(a: ToolArgs, name: string, maxLength: number = 1000): string | null {
  return present(a[name]) ? sanitizeString(a[name], maxLength, name) : null;
}

export function offsetParams(a: ToolArgs, fallbackMaxResults: number = 50): Record<string, unknown> {
  const params: Record<string, unknown> = { maxResults: readMaxResults(a, fallbackMaxResults) };
  const startAt = readStartAt(a);
  if (startAt !== null) params.startAt = startAt;
  return params;
}

export function offsetPage(response: { startAt?: number; maxResults?: number; total?: number; isLast?: boolean }, returned: number, requested: Record<string, unknown>): Record<string, unknown> {
  const startAt = response.startAt ?? (requested.startAt as number | undefined) ?? 0;
  const total = response.total;
  const hasMore = response.isLast !== undefined
    ? response.isLast === false
    : total !== undefined ? startAt + returned < total : false;
  return { startAt, total: total ?? startAt + returned, hasMore };
}

export function tokenPage(response: { isLast?: boolean; nextPageToken?: string | null }, returned: number): Record<string, unknown> {
  return {
    total: returned,
    nextPageToken: response.nextPageToken ?? null,
    hasMore: response.isLast === false || Boolean(response.nextPageToken),
  };
}
