import { JIRA_PROJECT_KEY } from './config.js';
import { jiraApi } from './http.js';
import { validateIssueKey, validateProjectKey, validateSafeParam } from './validation.js';
import { fetchCreateFields, describeMetaField, resolveIssueType } from './meta.js';
import { ISSUE_LIST_FIELDS, mapFilter, mapIssue, mapIssueSummary, mapProject } from './mappers.js';
import { buildJql, equalsClause } from './jql.js';
import type { JiraIssue } from './types.js';

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'jira://issue/{issueKey}',
    name: 'Jira issue',
    description: 'A single issue with its fields and links, as JSON.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'jira://project/{projectKey}',
    name: 'Jira project',
    description: 'Project metadata: key, name, lead, type and style.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'jira://project/{projectKey}/create-fields/{issueType}',
    name: 'Create screen',
    description: 'Every field on the create screen for one issue type, with required flags and allowed values.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'jira://filter/{filterId}',
    name: 'Saved filter',
    description: 'A saved filter with its JQL and owner.',
    mimeType: 'application/json',
  },
];

export function staticResources(): Record<string, unknown>[] {
  return [
    {
      uri: `jira://project/${JIRA_PROJECT_KEY}`,
      name: `Project ${JIRA_PROJECT_KEY}`,
      description: 'The project this server is configured against.',
      mimeType: 'application/json',
    },
    {
      uri: 'jira://my-open-issues',
      name: 'My open issues',
      description: 'Issues assigned to the authenticated user that are not done yet.',
      mimeType: 'application/json',
    },
  ];
}

async function readMyOpenIssues(): Promise<unknown> {
  const me = await jiraApi.get('/myself');
  const jql = buildJql({
    clauses: [
      equalsClause('assignee', me.data.accountId, 'accountId'),
      'statusCategory != Done',
    ],
    orderBy: 'updated DESC',
  });
  const response = await jiraApi.get('/search/jql', { params: { jql, maxResults: 50, fields: ISSUE_LIST_FIELDS } });
  const issues: JiraIssue[] = response.data.issues ?? [];
  return { jql, returned: issues.length, issues: issues.map(mapIssueSummary) };
}

export async function readResource(uri: string): Promise<unknown> {
  if (uri === 'jira://my-open-issues') {
    return readMyOpenIssues();
  }

  const issue = uri.match(/^jira:\/\/issue\/([^/]+)$/);
  if (issue) {
    const issueKey = validateIssueKey(decodeURIComponent(issue[1]));
    const response = await jiraApi.get(`/issue/${issueKey}`);
    return mapIssue(response.data);
  }

  const createFields = uri.match(/^jira:\/\/project\/([^/]+)\/create-fields\/([^/]+)$/);
  if (createFields) {
    const projectKey = validateProjectKey(decodeURIComponent(createFields[1]));
    const issueType = validateSafeParam(decodeURIComponent(createFields[2]), 'issueType');
    const resolved = await resolveIssueType(projectKey, issueType);
    if (!resolved?.id) {
      throw new Error(`Issue type "${issueType}" not found in project ${projectKey}`);
    }
    const fields = await fetchCreateFields(projectKey, resolved.id);
    return {
      projectKey,
      issueType: { id: resolved.id, name: resolved.name },
      fields: fields.map(describeMetaField),
    };
  }

  const project = uri.match(/^jira:\/\/project\/([^/]+)$/);
  if (project) {
    const projectKey = validateProjectKey(decodeURIComponent(project[1]));
    const response = await jiraApi.get(`/project/${projectKey}`);
    return mapProject(response.data);
  }

  const filter = uri.match(/^jira:\/\/filter\/([^/]+)$/);
  if (filter) {
    const filterId = validateSafeParam(decodeURIComponent(filter[1]), 'filterId', 30);
    const response = await jiraApi.get(`/filter/${filterId}`);
    return mapFilter(response.data);
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}
