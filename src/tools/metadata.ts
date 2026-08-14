import type { JiraLinkType, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { offsetPage, offsetParams, present } from '../args.js';
import { createSuccessResponse, resolveProjectKey } from '../responses.js';
import { validateIssueKey, validatePermissionKeys, validateProjectKey, validateSafeParam } from '../validation.js';
import {
  describeMetaField, fetchCreateFields, fetchFieldIndex, fetchIssueTypes, fetchPriorities, resolveIssueType,
} from '../meta.js';
import { defineTool } from '../registry.js';
import { META_FIELDS_OUTPUT } from '../outputs.js';

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
    const types = await fetchIssueTypes(projectKey);
    if (types.length === 0) {
      throw new Error(
        `Could not read the create screen for project ${projectKey}: it reported no issue types. Check that the project key is right and that your account can create issues in it. Passing a numeric issue type id skips this lookup.`,
      );
    }
    const available = types.map(t => `${t.name} (id ${t.id})`).join(', ');
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
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get all available Jira fields. Useful for finding custom field IDs.',
  inputSchema: { type: 'object' as const, properties: {} },
  handler: handleGetFields,
});

export const GetIssueTypesTool = defineTool({
  name: 'jira_get_issue_types',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  outputSchema: META_FIELDS_OUTPUT,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get all available issue priorities. Returns id first: the name is rendered in the Jira account language and Jira only accepts the canonical English name or the id on create/update, so pass the id.',
  inputSchema: { type: 'object' as const, properties: {} },
  handler: handleGetPriorities,
});

export const GetLinkTypesTool = defineTool({
  name: 'jira_get_link_types',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get all available issue link types.',
  inputSchema: { type: 'object' as const, properties: {} },
  handler: handleGetLinkTypes,
});

export async function handleGetProjectStatuses(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}/statuses`);
  const types: { id?: string; name?: string; statuses?: { id?: string; name?: string; statusCategory?: { key?: string } }[] }[] = response.data ?? [];

  return createSuccessResponse({
    projectKey,
    note: 'Status names are rendered in the Jira account language. Match them case-insensitively, and prefer jira_list_transitions when changing a status.',
    issueTypes: types.map(type => ({
      id: type.id,
      name: type.name,
      statuses: (type.statuses ?? []).map(status => ({
        id: status.id,
        name: status.name,
        category: status.statusCategory?.key,
      })),
    })),
  });
}

export async function handleListLabels(a: ToolArgs): Promise<ToolResponse> {
  const params = offsetParams(a, 100);
  const response = await jiraApi.get('/label', { params });
  const labels: string[] = response.data.values ?? [];
  return createSuccessResponse({
    ...offsetPage(response.data, labels.length, params),
    labels,
  });
}

const DEFAULT_PERMISSIONS = [
  'BROWSE_PROJECTS', 'CREATE_ISSUES', 'EDIT_ISSUES', 'DELETE_ISSUES', 'ASSIGN_ISSUES',
  'ASSIGNABLE_USER', 'TRANSITION_ISSUES', 'ADD_COMMENTS', 'DELETE_ALL_COMMENTS',
  'CREATE_ATTACHMENTS', 'DELETE_ALL_ATTACHMENTS', 'WORK_ON_ISSUES', 'LINK_ISSUES',
  'MANAGE_WATCHERS', 'RESOLVE_ISSUES', 'CLOSE_ISSUES', 'MODIFY_REPORTER', 'ADMINISTER_PROJECTS',
];

export async function handleGetMyPermissions(a: ToolArgs): Promise<ToolResponse> {
  const requested = present(a.permissions)
    ? validatePermissionKeys(a.permissions)
    : DEFAULT_PERMISSIONS;

  const params: Record<string, unknown> = { permissions: requested.join(',') };
  if (present(a.projectKey)) params.projectKey = validateProjectKey(a.projectKey);
  if (present(a.issueKey)) params.issueKey = validateIssueKey(a.issueKey);

  const response = await jiraApi.get('/mypermissions', { params });
  const permissions: Record<string, { havePermission?: boolean; name?: string }> = response.data.permissions ?? {};

  const granted: string[] = [];
  const denied: string[] = [];
  for (const [key, value] of Object.entries(permissions)) {
    (value.havePermission ? granted : denied).push(key);
  }

  return createSuccessResponse({
    scope: { projectKey: params.projectKey ?? null, issueKey: params.issueKey ?? null },
    granted,
    denied,
  });
}

export const GetProjectStatusesTool = defineTool({
  name: 'jira_get_project_statuses',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get every status available per issue type in a project, with its status category. Use it to write correct JQL and to know which statuses exist before trying to transition to one.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
    },
  },
  handler: handleGetProjectStatuses,
});

export const ListLabelsTool = defineTool({
  name: 'jira_list_labels',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'List labels that already exist in this Jira instance. Use it to reuse an existing label instead of inventing a near-duplicate.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      maxResults: { type: 'number', description: 'Maximum number of labels (1-100)', default: 100 },
      startAt: { type: 'number', description: 'Zero-based index of the first label to return' },
    },
  },
  handler: handleListLabels,
});

export const GetMyPermissionsTool = defineTool({
  name: 'jira_get_my_permissions',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Check what the authenticated user is allowed to do, optionally scoped to a project or an issue. Call it before a bulk operation to fail early with a clear reason instead of collecting permission errors issue by issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Scope the check to a project' },
      issueKey: { type: 'string', description: 'Scope the check to a single issue' },
      permissions: { type: 'array', items: { type: 'string' }, description: 'Permission keys to check, e.g. ["EDIT_ISSUES", "DELETE_ISSUES"]. Defaults to the common project permissions.' },
    },
  },
  handler: handleGetMyPermissions,
});

export const METADATA_TOOLS = [
  GetProjectStatusesTool,
  ListLabelsTool,
  GetMyPermissionsTool,
  GetFieldsTool,
  GetIssueTypesTool,
  GetCreateFieldsTool,
  GetPrioritiesTool,
  GetLinkTypesTool,
];
