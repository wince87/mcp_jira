import type { AxiosError } from 'axios';
import type { CreateMetaField, ImageContent, JiraAttachment, JiraChangelogHistory, JiraIssueFields, JiraRemoteLink, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { offsetPage, offsetParams, present } from '../args.js';
import { JIRA_PROJECT_KEY, STORY_POINTS_FIELD } from '../config.js';
import { collectMediaIds, createADFDocument } from '../adf.js';
import {
  MAX_INLINE_IMAGE_BYTES, createIssueUrl, createMixedResponse, createSuccessResponse, imageContent,
  isImageMime, resolveProjectKey,
} from '../responses.js';
import { sanitizeString, validateAccountId, validateFieldMap, validateFieldSelection, validateHttpUrl, validateIssueKey, validateProjectKey, validateSafeParam } from '../validation.js';
import { applyOptionalFields, convertDocFields, describeMetaField, dryRunResult, fetchIssueTypes, postIssue, putIssue, resolveIssueTypeValue, resolvePriorityValue, safeCreateMeta } from '../meta.js';
import { describeTransitions, fetchTransitions, postTransition, resolveTransition } from '../transitions.js';
import { issueSnapshot, mapCustomFields, mapIssue, mapUser, namesOf, simplifyFieldValue } from '../mappers.js';
import { defineTool } from '../registry.js';
import { PRIORITY_SCHEMA, COMMON_ISSUE_FIELDS_SCHEMA } from '../schemas.js';

export async function handleCreateIssue(a: ToolArgs): Promise<ToolResponse> {
  const { summary, description, issueType = 'Task' } = a;
  const projectKey = resolveProjectKey(a);

  validateSafeParam(issueType, 'issueType');
  const meta = await safeCreateMeta(projectKey, issueType);

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: sanitizeString(summary, 500, 'summary'),
    description: createADFDocument(description),
    issuetype: await resolveIssueTypeValue(issueType, projectKey),
  };

  await applyOptionalFields(a, fields, meta);

  if (a.dryRun === true) {
    return createSuccessResponse(dryRunResult(projectKey, issueType, fields, meta));
  }

  const response = await postIssue(projectKey, issueType, fields);

  return createSuccessResponse({
    success: true,
    key: response.data.key,
    id: response.data.id,
    url: createIssueUrl(response.data.key),
    issue: await issueSnapshot(response.data.key),
  });
}


export async function handleGetIssue(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const selection = a.fields !== undefined && a.fields !== null ? validateFieldSelection(a.fields) : null;

  const params: Record<string, unknown> = {};
  if (selection) params.fields = selection.join(',');

  const response = await jiraApi.get(`/issue/${issueKey}`, { params });
  const f: JiraIssueFields = response.data.fields ?? {};

  const data: Record<string, unknown> = selection
    ? {
      key: response.data.key,
      url: createIssueUrl(response.data.key),
      fields: Object.fromEntries(Object.entries(f).map(([id, value]) => [id, simplifyFieldValue(value)])),
    }
    : mapIssue(response.data);

  if (a.includeCustomFields === true) {
    data.customFields = await mapCustomFields(f);
  }

  if (a.includeImages !== true) {
    return createSuccessResponse(data);
  }

  const attachments: JiraAttachment[] = f.attachment ?? [];
  const imageAttachments = attachments.filter(att =>
    isImageMime(att.mimeType) && typeof att.size === 'number' && att.size <= MAX_INLINE_IMAGE_BYTES,
  );
  const embeddedIds = new Set(collectMediaIds(f.description));
  const ordered = [
    ...imageAttachments.filter(att => att.id && embeddedIds.has(att.id)),
    ...imageAttachments.filter(att => !att.id || !embeddedIds.has(att.id)),
  ].slice(0, 10);

  const images: ImageContent[] = [];
  for (const att of ordered) {
    if (!att.id || !att.mimeType) continue;
    const content = await jiraApi.get(`/attachment/content/${att.id}`, { responseType: 'arraybuffer' });
    images.push(imageContent(Buffer.from(content.data), att.mimeType));
  }

  return createMixedResponse({ ...data, imagesReturned: images.length }, images);
}

export async function handleUpdateIssue(a: ToolArgs): Promise<ToolResponse> {
  const { summary, description, status, transitionId, transitionFields } = a;
  const issueKey = validateIssueKey(a.issueKey);

  const fields: Record<string, unknown> = {};
  if (summary) {
    fields.summary = sanitizeString(summary, 500, 'summary');
  }
  if (description) {
    fields.description = createADFDocument(description);
  }
  await applyOptionalFields(a, fields, null);

  const hasFieldUpdates = Object.keys(fields).length > 0;
  if (hasFieldUpdates) {
    await putIssue(issueKey, fields);
  }

  const warnings: string[] = [];
  let applied: Record<string, unknown> | null = null;

  if (status || transitionId) {
    const transitionList = await fetchTransitions(issueKey);
    const requestedId = transitionId !== undefined && transitionId !== null
      ? validateSafeParam(transitionId, 'transitionId', 30)
      : null;
    const requestedStatus = requestedId ? null : sanitizeString(status, 100, 'status');
    const transition = resolveTransition(transitionList, { id: requestedId, status: requestedStatus });

    if (transition) {
      const payload: Record<string, unknown> = { transition: { id: transition.id } };
      if (transitionFields !== undefined && transitionFields !== null) {
        payload.fields = await convertDocFields(validateFieldMap(transitionFields, 'transitionFields'), null);
      }
      await postTransition(issueKey, transition.id, payload);
      applied = { id: transition.id, name: transition.name, to: transition.to?.name };
    } else {
      warnings.push(
        `No transition matching "${requestedId ?? status}" on ${issueKey}. Available: ${describeTransitions(transitionList)}`,
      );
    }
  }

  if (!hasFieldUpdates && !status && !transitionId) {
    return createSuccessResponse({ success: false, message: `No updates provided for ${issueKey}` });
  }

  const result: Record<string, unknown> = {
    success: warnings.length === 0,
    message: `Issue ${issueKey} updated${warnings.length > 0 ? ' with warnings' : ' successfully'}`,
    url: createIssueUrl(issueKey),
  };

  if (applied) {
    result.transition = applied;
  }
  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return createSuccessResponse(result);
}

export async function handleDeleteIssue(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const deleteSubtasks = a.deleteSubtasks === true;
  await jiraApi.delete(`/issue/${issueKey}`, { params: { deleteSubtasks } });
  return createSuccessResponse({
    success: true,
    message: `Issue ${issueKey} deleted permanently${deleteSubtasks ? ', along with its subtasks' : ''}`,
  });
}

export async function resolveSubtaskTypeName(projectKey: string, requested: unknown): Promise<string> {
  if (requested !== undefined && requested !== null) {
    return validateSafeParam(requested, 'issueType');
  }
  try {
    const types = await fetchIssueTypes(projectKey);
    return types.find(t => t.subtask === true)?.name ?? 'Subtask';
  } catch {
    return 'Subtask';
  }
}

export async function handleCreateSubtask(a: ToolArgs): Promise<ToolResponse> {
  const { parentKey, summary, description } = a;
  const parent = validateIssueKey(parentKey);
  const projectKey = resolveProjectKey(a);
  const issueType = await resolveSubtaskTypeName(projectKey, a.issueType);
  const meta = await safeCreateMeta(projectKey, issueType);

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: sanitizeString(summary, 500, 'summary'),
    description: createADFDocument(description),
    issuetype: await resolveIssueTypeValue(issueType, projectKey),
  };

  await applyOptionalFields(a, fields, meta);
  fields.parent = { key: parent };

  if (a.dryRun === true) {
    return createSuccessResponse(dryRunResult(projectKey, issueType, fields, meta));
  }

  const response = await postIssue(projectKey, issueType, fields);

  return createSuccessResponse({
    success: true,
    key: response.data.key,
    id: response.data.id,
    parent,
    url: createIssueUrl(response.data.key),
    issue: await issueSnapshot(response.data.key),
  });
}

export async function handleAssignIssue(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const accountId = a.accountId === null || a.accountId === undefined ? null : validateAccountId(a.accountId);
  await jiraApi.put(`/issue/${issueKey}/assignee`, { accountId });
  return createSuccessResponse({
    success: true,
    message: accountId ? `Issue ${issueKey} assigned to ${accountId}` : `Issue ${issueKey} unassigned`,
    url: createIssueUrl(issueKey),
  });
}

export async function handleCloneIssue(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);

  const source = await jiraApi.get(`/issue/${issueKey}`);
  const f: JiraIssueFields = source.data.fields;
  const projectKey = a.projectKey ? validateProjectKey(a.projectKey) : f.project?.key ?? JIRA_PROJECT_KEY;
  const summary = a.summary ? sanitizeString(a.summary, 500, 'summary') : `Clone of ${f.summary}`;

  const issueType = f.issuetype?.name ?? 'Task';
  const meta = await safeCreateMeta(projectKey, issueType);

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary,
    description: f.description ?? createADFDocument(''),
    issuetype: await resolveIssueTypeValue(issueType, projectKey),
  };

  if (f.labels?.length) {
    fields.labels = f.labels;
  }
  if (f.priority?.name) {
    fields.priority = await resolvePriorityValue(f.priority.name, meta);
  }
  if (f[STORY_POINTS_FIELD] !== undefined && f[STORY_POINTS_FIELD] !== null) {
    fields[STORY_POINTS_FIELD] = f[STORY_POINTS_FIELD];
  }
  for (const copied of ['versions', 'fixVersions', 'components'] as const) {
    const values = namesOf(f[copied]);
    if (values.length > 0) fields[copied] = values.map(name => ({ name }));
  }

  await applyOptionalFields(a, fields, meta);

  const response = await postIssue(projectKey, issueType, fields);

  return createSuccessResponse({
    success: true,
    key: response.data.key,
    id: response.data.id,
    clonedFrom: issueKey,
    url: createIssueUrl(response.data.key),
    issue: await issueSnapshot(response.data.key),
  });
}

export async function handleLinkIssues(a: ToolArgs): Promise<ToolResponse> {
  const { linkType = 'Relates' } = a;
  const inwardIssue = validateIssueKey(a.inwardIssue);
  const outwardIssue = validateIssueKey(a.outwardIssue);
  const validatedLinkType = validateSafeParam(linkType, 'linkType');

  try {
    await jiraApi.post('/issueLink', {
      type: { name: validatedLinkType },
      inwardIssue: { key: inwardIssue },
      outwardIssue: { key: outwardIssue },
    });
    return createSuccessResponse({ success: true, message: `Linked ${inwardIssue} to ${outwardIssue} with type "${validatedLinkType}"` });
  } catch (linkError) {
    const axiosErr = linkError as AxiosError<{ errorMessages?: string[] }>;
    const errorMessages = axiosErr.response?.data?.errorMessages ?? [];
    const isDuplicate = axiosErr.response?.status === 400 &&
      errorMessages.some(m => /link.*(already|exist)/i.test(m));
    if (isDuplicate) {
      return createSuccessResponse({ success: true, message: `Link between ${inwardIssue} and ${outwardIssue} already exists`, alreadyLinked: true });
    }
    throw linkError;
  }
}

export async function handleGetChangelog(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);

  const params = offsetParams(a);
  const response = await jiraApi.get(`/issue/${issueKey}/changelog`, { params });

  const histories: JiraChangelogHistory[] = response.data.values ?? [];
  return createSuccessResponse({
    issueKey,
    ...offsetPage(response.data, histories.length, params),
    histories: histories.map(h => ({
      id: h.id,
      author: mapUser(h.author),
      created: h.created,
      items: (h.items ?? []).map(item => ({
        field: item.field,
        from: item.fromString,
        to: item.toString,
      })),
    })),
  });
}

export const CreateIssueTool = defineTool({
  name: 'jira_create_issue',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Create a new Jira issue. Description supports Markdown (auto-converted to ADF). To create an Epic use jira_create_epic. Call jira_get_create_fields(projectKey, issueType) first when the screen is unknown — it returns every field with required, type and allowedValues, which removes the guesswork (Bug screens commonly require Affects versions and other mandatory fields). Optional fields are only sent when provided, so nothing is rejected for not being on the screen. On a 400 the response carries missingRequired and allowedValues. Set dryRun to validate the payload without creating anything.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string', description: 'Issue summary/title' },
      description: { type: 'string', description: 'Issue description in Markdown. Use [KEY](url) for clickable issue links.' },
      issueType: { type: 'string', description: 'Issue type name or id. Names are localized on non-English instances; a name is resolved to an id automatically. Call jira_get_issue_types for the definitive list.', default: 'Task' },
      priority: PRIORITY_SCHEMA,
      storyPoints: { type: 'number', description: 'Story points estimate (0-1000)' },
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
      parent: { type: 'string', description: 'Parent issue key — the epic for a story, or the parent for a subtask (e.g. "PROJ-12").' },
      ...COMMON_ISSUE_FIELDS_SCHEMA,
      dryRun: { type: 'boolean', description: 'When true, validate the payload against the create screen and return missingRequired / invalidValues / fieldsNotOnScreen without creating the issue.', default: false },
    },
    required: ['summary', 'description'],
  },
  handler: handleCreateIssue,
});

export const GetIssueTool = defineTool({
  name: 'jira_get_issue',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get details of a Jira issue. The default response includes status, resolution, assignee, priority, labels, story points, parent, components, versions, fixVersions, dueDate and timetracking. Set includeCustomFields to also get every populated custom field with its human-readable name (rich-text ones rendered as Markdown), or pass fields to select an exact set. Set includeImages to return embedded/attached images inline.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., TTC-123)' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Exact field IDs to return (passed to the Jira ?fields= parameter), e.g. ["summary", "versions", "customfield_10122"] or ["*all"]. When set, the response returns a raw fields map instead of the default shape.' },
      includeCustomFields: { type: 'boolean', description: 'When true, add a customFields map of every populated customfield_NNNNN with { name, type, value }. Rich-text (doc) fields are converted to Markdown.', default: false },
      includeImages: { type: 'boolean', description: 'When true, return up to 10 image attachments (image/*, each <=5MB) as inline images, embedded-in-description ones first. Default false.', default: false },
    },
    required: ['issueKey'],
  },
  handler: handleGetIssue,
});

export const UpdateIssueTool = defineTool({
  name: 'jira_update_issue',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Update fields and/or status of an issue. status is matched against the target status of each available transition first (so "In Progress" works even when the transition is named "Start work"), then against transition names, case-insensitively. Use transitionId for an exact transition and transitionFields when the transition screen requires input (e.g. an estimate) — jira_list_transitions with includeFields lists what each one needs. On a 400 the response carries missingRequired and allowedValues.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key to update' },
      summary: { type: 'string', description: 'New summary' },
      description: { type: 'string', description: 'New description in Markdown. Use [KEY](url) for clickable issue links.' },
      status: { type: 'string', description: 'Target status name (e.g. "In Progress", "To Do") or transition name. Matched on the transition target status first, then the transition name, case-insensitively.' },
      transitionId: { type: 'string', description: 'Exact transition id from jira_list_transitions. Takes precedence over status.' },
      transitionFields: { type: 'object', additionalProperties: true, description: 'Fields required by the transition screen, keyed by field ID (e.g. { "customfield_10016": 3, "resolution": { "id": "10000" } }). Call jira_list_transitions with includeFields to see what a transition requires.' },
      priority: PRIORITY_SCHEMA,
      storyPoints: { type: 'number', description: 'Story points estimate (0-1000)' },
      parent: { type: 'string', description: 'New parent issue key (epic or parent task).' },
      ...COMMON_ISSUE_FIELDS_SCHEMA,
    },
    required: ['issueKey'],
  },
  handler: handleUpdateIssue,
});

export async function handleDeleteIssueLink(a: ToolArgs): Promise<ToolResponse> {
  const linkId = validateSafeParam(a.linkId, 'linkId', 30);
  await jiraApi.delete(`/issueLink/${linkId}`);
  return createSuccessResponse({ success: true, message: `Issue link ${linkId} deleted` });
}

export const DeleteIssueLinkTool = defineTool({
  name: 'jira_delete_issue_link',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description: 'Remove a link between two issues. The linkId comes from the links array returned by jira_get_issue, not from the issue keys.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      linkId: { type: 'string', description: 'Link ID from jira_get_issue links[].id' },
    },
    required: ['linkId'],
  },
  handler: handleDeleteIssueLink,
});

export const LinkIssuesTool = defineTool({
  name: 'jira_link_issues',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Create a link between two issues. The inward side uses the linkType.inward phrasing ("is blocked by", "duplicates"), the outward side uses linkType.outward ("blocks", "is duplicated by"). If unsure which linkType names exist in this instance, call jira_get_link_types. Call sequentially (2-3 at a time) to avoid permission prompt storms in Claude Code.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      inwardIssue: { type: 'string', description: 'Issue key on the inward side (the one that "is blocked by" / "duplicates" the other)' },
      outwardIssue: { type: 'string', description: 'Issue key on the outward side (the one that "blocks" / "is duplicated by" the inward one)' },
      linkType: { type: 'string', description: 'Link type name. Common: Relates, Blocks, Duplicate, Cloners. Call jira_get_link_types for instance-specific list.', default: 'Relates' },
    },
    required: ['inwardIssue', 'outwardIssue'],
  },
  handler: handleLinkIssues,
});

export const DeleteIssueTool = defineTool({
  name: 'jira_delete_issue',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description: 'Permanently delete a Jira issue. This cannot be undone and there is no trash to restore from — confirm with the user before calling it. An issue that has subtasks is rejected unless deleteSubtasks is set, which deletes them too.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key to delete (e.g., TTC-123)' },
      deleteSubtasks: { type: 'boolean', description: 'Also delete every subtask of this issue. Without it, Jira refuses to delete an issue that has subtasks.', default: false },
    },
    required: ['issueKey'],
  },
  handler: handleDeleteIssue,
});

export const CreateSubtaskTool = defineTool({
  name: 'jira_create_subtask',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Create a subtask under a parent issue. Description supports standard Markdown, automatically converted to ADF. The subtask issue type is discovered from the project (handles "Sub-task" vs "Subtask" and localized names) unless issueType is given.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      parentKey: { type: 'string', description: 'Parent issue key (e.g., TTC-261)' },
      summary: { type: 'string', description: 'Subtask summary/title' },
      description: { type: 'string', description: 'Subtask description in Markdown. Use [KEY](url) for clickable issue links.' },
      issueType: { type: 'string', description: 'Subtask issue type name or id. Defaults to the project\'s subtask type.' },
      priority: PRIORITY_SCHEMA,
      storyPoints: { type: 'number', description: 'Story points estimate (0-1000)' },
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
      ...COMMON_ISSUE_FIELDS_SCHEMA,
      dryRun: { type: 'boolean', description: 'When true, validate against the create screen and return what is missing without creating the subtask.', default: false },
    },
    required: ['parentKey', 'summary', 'description'],
  },
  handler: handleCreateSubtask,
});

export const AssignIssueTool = defineTool({
  name: 'jira_assign_issue',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Assign or unassign a user. Jira uses accountId (not email or username). To find accountId: call jira_search_users by name/email, or jira_get_myself for the current user. Pass null accountId to unassign.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      accountId: { type: ['string', 'null'], description: 'Atlassian accountId of the assignee (opaque string like "5b10a2844c20165700ede21g"), or null to unassign. Get via jira_search_users or jira_get_myself.' },
    },
    required: ['issueKey'],
  },
  handler: handleAssignIssue,
});

export const GetChangelogTool = defineTool({
  name: 'jira_get_changelog',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get the change history of a Jira issue (who changed what and when).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      maxResults: { type: 'number', description: 'Maximum number of changelog entries (1-100)', default: 50 },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
    },
    required: ['issueKey'],
  },
  handler: handleGetChangelog,
});

export const CloneIssueTool = defineTool({
  name: 'jira_clone_issue',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Clone an existing Jira issue with a new summary. Copies issue type, description, labels, priority, story points, components and versions from the source. Custom fields are NOT copied — supply any the target screen requires via customFields. Any field passed explicitly overrides the copied value.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key to clone (e.g., PROJ-123)' },
      summary: { type: 'string', description: 'Summary for the cloned issue (defaults to "Clone of <original>")' },
      projectKey: { type: 'string', description: 'Target project key (defaults to same project as source)' },
      priority: PRIORITY_SCHEMA,
      storyPoints: { type: 'number', description: 'Story points estimate (0-1000). Overrides the copied value.' },
      parent: { type: 'string', description: 'Parent issue key (epic or parent task).' },
      ...COMMON_ISSUE_FIELDS_SCHEMA,
    },
    required: ['issueKey'],
  },
  handler: handleCloneIssue,
});

export async function handleGetEditFields(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}/editmeta`);
  const raw: Record<string, CreateMetaField> = response.data.fields ?? {};
  const described = Object.entries(raw).map(([fieldId, field]) => describeMetaField({ ...field, fieldId }));

  return createSuccessResponse({
    issueKey,
    editableFields: described.map(f => f.fieldId),
    requiredFields: described.filter(f => f.required === true && f.hasDefaultValue !== true).map(f => f.fieldId),
    fields: described,
  });
}

export async function handleGetRemoteLinks(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}/remotelink`);
  const links: JiraRemoteLink[] = response.data ?? [];
  return createSuccessResponse({
    issueKey,
    returned: links.length,
    links: links.map(link => ({
      id: link.id,
      globalId: link.globalId,
      relationship: link.relationship,
      url: link.object?.url,
      title: link.object?.title,
      summary: link.object?.summary,
      application: link.application?.name,
    })),
  });
}

export async function handleAddRemoteLink(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const url = validateHttpUrl(a.url, 'url');

  const object: Record<string, unknown> = { url, title: sanitizeString(a.title, 255, 'title') };
  if (present(a.summary)) object.summary = sanitizeString(a.summary, 2000, 'summary');

  const payload: Record<string, unknown> = { object };
  if (present(a.relationship)) payload.relationship = sanitizeString(a.relationship, 100, 'relationship');
  if (present(a.globalId)) payload.globalId = sanitizeString(a.globalId, 255, 'globalId');

  const response = await jiraApi.post(`/issue/${issueKey}/remotelink`, payload);
  return createSuccessResponse({ success: true, issueKey, id: response.data?.id, url });
}

export async function handleDeleteRemoteLink(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const linkId = validateSafeParam(a.linkId, 'linkId', 40);
  await jiraApi.delete(`/issue/${issueKey}/remotelink/${linkId}`);
  return createSuccessResponse({ success: true, message: `Remote link ${linkId} removed from ${issueKey}` });
}

export const GetEditFieldsTool = defineTool({
  name: 'jira_get_edit_fields',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get the edit screen for one existing issue: every field you may change, with required flags, types and allowed values. This is the update-time mirror of jira_get_create_fields, and the way to find out why a field is rejected on jira_update_issue.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
    },
    required: ['issueKey'],
  },
  handler: handleGetEditFields,
});

export const GetRemoteLinksTool = defineTool({
  name: 'jira_get_remote_links',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'List web links attached to an issue — pull requests, Confluence pages, dashboards, anything outside Jira. These are separate from issue-to-issue links, which jira_get_issue returns.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
    },
    required: ['issueKey'],
  },
  handler: handleGetRemoteLinks,
});

export const AddRemoteLinkTool = defineTool({
  name: 'jira_add_remote_link',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Attach a web link to an issue, e.g. the pull request that implements it or the Confluence page that specifies it.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      url: { type: 'string', description: 'Link target. Must be http or https.' },
      title: { type: 'string', description: 'Link text shown on the issue' },
      summary: { type: 'string', description: 'Optional longer description' },
      relationship: { type: 'string', description: 'How the link relates, e.g. "implemented by", "documented in"' },
      globalId: { type: 'string', description: 'Stable identifier. Posting the same globalId again updates that link instead of adding a duplicate.' },
    },
    required: ['issueKey', 'url', 'title'],
  },
  handler: handleAddRemoteLink,
});

export const DeleteRemoteLinkTool = defineTool({
  name: 'jira_delete_remote_link',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description: 'Remove a web link from an issue. Link ids come from jira_get_remote_links.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
      linkId: { type: 'string', description: 'Remote link ID from jira_get_remote_links' },
    },
    required: ['issueKey', 'linkId'],
  },
  handler: handleDeleteRemoteLink,
});

export const ISSUES_TOOLS = [
  GetEditFieldsTool,
  GetRemoteLinksTool,
  AddRemoteLinkTool,
  DeleteRemoteLinkTool,
  CreateIssueTool,
  GetIssueTool,
  UpdateIssueTool,
  LinkIssuesTool,
  DeleteIssueLinkTool,
  DeleteIssueTool,
  CreateSubtaskTool,
  AssignIssueTool,
  GetChangelogTool,
  CloneIssueTool,
];
