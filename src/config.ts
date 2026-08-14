import { validateProjectKey } from './validation.js';

export function getRequiredEnv(name: string, fallback: string | null = null): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') {
    return value;
  }
  if (fallback !== null && fallback !== undefined && fallback !== '') {
    return fallback;
  }
  throw new Error(`Required environment variable ${name} is not set. Set it via your MCP client config or shell environment.`);
}

export const SERVER_VERSION = '3.0.2';

export const JIRA_URL: string = getRequiredEnv('JIRA_HOST', process.env.JIRA_URL ?? null);
export const JIRA_EMAIL: string = getRequiredEnv('JIRA_EMAIL');
export const JIRA_API_TOKEN: string = getRequiredEnv('JIRA_API_TOKEN');
export const JIRA_PROJECT_KEY: string = validateProjectKey(process.env.JIRA_PROJECT_KEY || 'PROJ');
export const STORY_POINTS_FIELD: string = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
export const EPIC_NAME_FIELD: string = process.env.JIRA_EPIC_NAME_FIELD || 'customfield_10011';

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export const JIRA_TIMEOUT_MS: number = readPositiveInt('JIRA_TIMEOUT_MS', 30000);
export const JIRA_MAX_RETRIES: number = readPositiveInt('JIRA_MAX_RETRIES', 3);
export const JIRA_RETRY_BASE_MS: number = readPositiveInt('JIRA_RETRY_BASE_MS', 500);
export const JIRA_CONCURRENCY: number = readPositiveInt('JIRA_CONCURRENCY', 5);
export const JIRA_FORCE_ENGLISH: boolean = process.env.JIRA_FORCE_ENGLISH === 'true';

if (!JIRA_URL.startsWith('https://')) {
  throw new Error('JIRA_HOST must use HTTPS protocol for security');
}
