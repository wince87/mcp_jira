import type { JiraLinkType, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { validateSafeParam } from '../validation.js';
import {
  describeMetaField, fetchCreateFields, fetchFieldIndex, fetchIssueTypes, fetchPriorities, resolveIssueType,
} from '../meta.js';
import { defineTool } from '../registry.js';
import { JIRA_PROJECT_KEY } from '../config.js';

export async function handleGetFields(_a: ToolArgs): Promise<ToolResponse> {
  const fields = [...(await fetchFieldIndex()).values()];
  return createSuccessResponse({ fields: fields.map(f => ({ id: f.id, name: f.name, custom: f.custom, schema: f.schema })) });
}

export async function handleGetIssueTypes(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const issueTypes = await fetchIssueTypes(projectKey);
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

export const GetFieldsTool = defineTool({
  name: 'jira_get_fields',
  description: 'Get all available Jira fields. Useful for finding custom field IDs.',
  inputSchema: { type: 'object' as const, properties: {} },
  handler: handleGetFields,
});

export const GetIssueTypesTool = defineTool({
  name: 'jira_get_issue_types',
  description: 'Get all available issue types for a project. Names are rendered in the Jira account language — prefer the id when passing a type on. For the fields a given type requires, call jira_get_create_fields.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
    },
  },
  handler: handleGetIssueTypes,
});

export const GetCreateFieldsTool = defineTool({
  name: 'jira_get_create_fields',
  description: 'Get the create screen definition for one issue type: every field with fieldId, name, required, type and allowedValues, plus a requiredFields shortlist. This is the second createmeta step (jira_get_issue_types is the first) and it is what tells you which fields are mandatory and which values they accept. Call it before jira_create_issue on an unfamiliar project or issue type instead of guessing.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
      issueType: { type: 'string', description: 'Issue type name or id (e.g. "Bug" or "10004"). Names are matched case-insensitively and work with localized names.' },
    },
    required: ['issueType'],
  },
  handler: handleGetCreateFields,
});

export const GetPrioritiesTool = defineTool({
  name: 'jira_get_priorities',
  description: 'Get all available issue priorities. Returns id first: the name is rendered in the Jira account language and Jira only accepts the canonical English name or the id on create/update, so pass the id.',
  inputSchema: { type: 'object' as const, properties: {} },
  handler: handleGetPriorities,
});

export const GetLinkTypesTool = defineTool({
  name: 'jira_get_link_types',
  description: 'Get all available issue link types.',
  inputSchema: { type: 'object' as const, properties: {} },
  handler: handleGetLinkTypes,
});

export const METADATA_TOOLS = [
  GetFieldsTool,
  GetIssueTypesTool,
  GetCreateFieldsTool,
  GetPrioritiesTool,
  GetLinkTypesTool,
];
