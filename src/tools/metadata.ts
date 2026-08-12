import type { JiraField, JiraIssueType, JiraLinkType, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { validateSafeParam } from '../validation.js';
import {
  describeMetaField, fetchCreateFields, fetchIssueTypes, fetchPriorities, resolveIssueType,
} from '../meta.js';

export async function handleGetFields(_a: ToolArgs): Promise<ToolResponse> {
  const response = await jiraApi.get('/field');
  const fields: JiraField[] = response.data ?? [];
  return createSuccessResponse({ fields: fields.map(f => ({ id: f.id, name: f.name, custom: f.custom, schema: f.schema })) });
}

export async function handleGetIssueTypes(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/issue/createmeta/${projectKey}/issuetypes`);
  const issueTypes: JiraIssueType[] = response.data.values ?? [];
  return createSuccessResponse({
    projectKey,
    issueTypes: issueTypes.map(t => ({ id: t.id, name: t.name, subtask: t.subtask, description: t.description })),
  });
}

export async function handleGetCreateFields(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const issueType = validateSafeParam(a.issueType, 'issueType');

  const resolved = await resolveIssueType(projectKey, issueType);
  if (!resolved?.id) {
    const available = (await fetchIssueTypes(projectKey)).map(t => `${t.name} (id ${t.id})`).join(', ');
    throw new Error(`Issue type "${issueType}" not found in project ${projectKey}. Available: ${available}`);
  }

  const fields = await fetchCreateFields(projectKey, resolved.id);
  const described = fields.map(describeMetaField);

  return createSuccessResponse({
    projectKey,
    issueType: { id: resolved.id, name: resolved.name },
    requiredFields: described.filter(f => f.required === true && f.hasDefaultValue !== true).map(f => f.fieldId),
    fields: described,
  });
}

export async function handleGetPriorities(_a: ToolArgs): Promise<ToolResponse> {
  const priorities = await fetchPriorities();
  return createSuccessResponse({
    note: 'name is rendered in the Jira account language and is NOT accepted on create/update. Pass id.',
    priorities: priorities.map(p => ({ id: p.id, name: p.name, description: p.description, iconUrl: p.iconUrl })),
  });
}

export async function handleGetLinkTypes(_a: ToolArgs): Promise<ToolResponse> {
  const response = await jiraApi.get('/issueLinkType');
  const linkTypes: JiraLinkType[] = response.data.issueLinkTypes ?? [];
  return createSuccessResponse({ linkTypes: linkTypes.map(lt => ({ id: lt.id, name: lt.name, inward: lt.inward, outward: lt.outward })) });
}
