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

export const SERVER_VERSION = '2.8.0';

export const JIRA_URL: string = getRequiredEnv('JIRA_HOST', process.env.JIRA_URL ?? null);
export const JIRA_EMAIL: string = getRequiredEnv('JIRA_EMAIL');
export const JIRA_API_TOKEN: string = getRequiredEnv('JIRA_API_TOKEN');
export const JIRA_PROJECT_KEY: string = validateProjectKey(process.env.JIRA_PROJECT_KEY || 'PROJ');
export const STORY_POINTS_FIELD: string = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';

if (!JIRA_URL.startsWith('https://')) {
  throw new Error('JIRA_HOST must use HTTPS protocol for security');
}
