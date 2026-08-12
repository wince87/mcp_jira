import axios, { type AxiosInstance, type CreateAxiosDefaults } from 'axios';
import { JIRA_API_TOKEN, JIRA_EMAIL, JIRA_URL } from './config.js';

export const axiosAuthConfig: CreateAxiosDefaults = {
  auth: {
    username: JIRA_EMAIL,
    password: JIRA_API_TOKEN,
  },
  timeout: 30000,
};

export const jiraApi: AxiosInstance = axios.create({
  baseURL: `${JIRA_URL}/rest/api/3`,
  headers: { 'Content-Type': 'application/json' },
  ...axiosAuthConfig,
});

export const agileApi: AxiosInstance = axios.create({
  baseURL: `${JIRA_URL}/rest/agile/1.0`,
  headers: { 'Content-Type': 'application/json' },
  ...axiosAuthConfig,
});
