import axios, { type AxiosInstance, type CreateAxiosDefaults } from 'axios';
import { JIRA_API_TOKEN, JIRA_EMAIL, JIRA_FORCE_ENGLISH, JIRA_TIMEOUT_MS, JIRA_URL } from './config.js';

export const axiosAuthConfig: CreateAxiosDefaults = {
  auth: {
    username: JIRA_EMAIL,
    password: JIRA_API_TOKEN,
  },
  timeout: JIRA_TIMEOUT_MS,
};

function defaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (JIRA_FORCE_ENGLISH) {
    headers['Accept-Language'] = 'en-US';
    headers['X-Force-Accept-Language'] = 'true';
  }
  return headers;
}

function createClient(path: string): AxiosInstance {
  return axios.create({
    baseURL: `${JIRA_URL}${path}`,
    headers: defaultHeaders(),
    ...axiosAuthConfig,
  });
}

export const jiraApi: AxiosInstance = createClient('/rest/api/3');
export const agileApi: AxiosInstance = createClient('/rest/agile/1.0');

export const clients: AxiosInstance[] = [jiraApi, agileApi];
