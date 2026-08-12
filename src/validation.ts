import { resolve } from 'node:path';

export function validateIssueKey(key: unknown): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid issue key: must be a string');
  }
  if (!/^[A-Z]+-\d+$/.test(key)) {
    throw new Error(`Invalid issue key format: ${key}. Expected format: PROJECT-123`);
  }
  return key;
}

export function validateProjectKey(key: unknown): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid project key: must be a string');
  }
  if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(key)) {
    throw new Error(`Invalid project key format: ${key}. Expected 1-10 uppercase alphanumeric characters`);
  }
  return key;
}

export function validateJQL(jql: unknown): string {
  if (!jql || typeof jql !== 'string') {
    throw new Error('Invalid JQL query: must be a string');
  }
  if (jql.length > 5000) {
    throw new Error('JQL query too long: maximum 5000 characters');
  }
  return jql;
}

export function sanitizeString(str: unknown, maxLength: number = 1000, fieldName: string = 'input'): string {
  if (!str || typeof str !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (str.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
  }
  return str.trim();
}

export function validateSafeParam(str: unknown, fieldName: string, maxLength: number = 100): string {
  const value = sanitizeString(str, maxLength, fieldName);
  if (/[\/\\]/.test(value)) {
    throw new Error(`Invalid ${fieldName}: contains unsafe characters`);
  }
  return value;
}

export function validateMaxResults(maxResults: unknown): number {
  if (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1) {
    throw new Error('maxResults must be a positive integer');
  }
  return Math.min(maxResults, 100);
}

export function validateStoryPoints(points: unknown): number {
  if (typeof points !== 'number' || points < 0 || points > 1000) {
    throw new Error('Story points must be a number between 0 and 1000');
  }
  return points;
}

export function validateLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    throw new Error('Labels must be an array');
  }
  return labels.map((label: unknown, index: number) => {
    if (typeof label !== 'string') {
      throw new Error(`Label at index ${index} must be a string`);
    }
    if (label.length > 255) {
      throw new Error(`Label at index ${index} exceeds maximum length of 255 characters`);
    }
    return label;
  });
}

export function validateCustomFields(fields: unknown): Record<string, unknown> {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new Error('customFields must be an object mapping customfield_NNNNN keys to values');
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!/^customfield_\d{1,19}$/.test(key)) {
      throw new Error(`Invalid custom field key "${key}": must match customfield_NNNNN`);
    }
    if (value === undefined) {
      throw new Error(`Custom field "${key}" has undefined value`);
    }
    result[key] = value;
  }
  return result;
}

export function validateFieldMap(fields: unknown, paramName: string): Record<string, unknown> {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new Error(`${paramName} must be an object mapping field IDs to values`);
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) {
      throw new Error(`Invalid field key "${key}" in ${paramName}: must be a field ID like "customfield_10011" or "resolution"`);
    }
    if (value === undefined) {
      throw new Error(`Field "${key}" in ${paramName} has undefined value`);
    }
    result[key] = value;
  }
  return result;
}

export function validateReferenceList(input: unknown, fieldName: string): Record<string, string>[] {
  if (!Array.isArray(input)) {
    throw new Error(`${fieldName} must be an array of names or numeric ids`);
  }
  return input.map((item, index) => {
    const value = sanitizeString(item, 255, `${fieldName}[${index}]`);
    const reference: Record<string, string> = {};
    if (/^\d+$/.test(value)) {
      reference.id = value;
    } else {
      reference.name = value;
    }
    return reference;
  });
}

export function validateDate(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be a date in YYYY-MM-DD format`);
  }
  return value;
}

export function validateTimetracking(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('timetracking must be an object with originalEstimate and/or remainingEstimate');
  }
  const input = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  if (input.originalEstimate !== undefined && input.originalEstimate !== null) {
    result.originalEstimate = sanitizeString(input.originalEstimate, 50, 'timetracking.originalEstimate');
  }
  if (input.remainingEstimate !== undefined && input.remainingEstimate !== null) {
    result.remainingEstimate = sanitizeString(input.remainingEstimate, 50, 'timetracking.remainingEstimate');
  }
  if (Object.keys(result).length === 0) {
    throw new Error('timetracking requires originalEstimate and/or remainingEstimate');
  }
  return result;
}

export function validateAccountId(id: unknown): string {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid accountId: must be a string');
  }
  if (!/^[a-zA-Z0-9:._-]{1,128}$/.test(id)) {
    throw new Error('Invalid accountId: must be 1-128 alphanumeric characters (with :._-)');
  }
  return id;
}

export function validateISO8601(value: unknown, fieldName: string = 'datetime'): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be ISO 8601 with timezone offset (e.g., "2024-01-15T09:00:00.000+0000")`);
  }
  return value;
}

export const ALLOWED_ATTACHMENT_BASES: string[] = [process.cwd(), process.env.HOME ?? ''].filter((b): b is string => b.length > 0);

export function validateAttachmentPath(filePath: string): string {
  const absolutePath = resolve(filePath);
  const withinAllowed = ALLOWED_ATTACHMENT_BASES.some(base => absolutePath === base || absolutePath.startsWith(base + '/'));
  if (!withinAllowed) {
    throw new Error('filePath must be within the current working directory or user home directory');
  }
  return absolutePath;
}
