import type { AxiosError } from 'axios';
import type {
  JiraAttachment, JiraChangelogHistory, JiraIssueFields, ImageContent, ToolArgs, ToolResponse,
} from '../types.js';
import { jiraApi } from '../http.js';
import { JIRA_PROJECT_KEY, STORY_POINTS_FIELD } from '../config.js';
import { collectMediaIds, createADFDocument } from '../adf.js';
import {
  MAX_INLINE_IMAGE_BYTES, createIssueUrl, createMixedResponse, createSuccessResponse, imageContent,
  isImageMime, resolveProjectKey,
} from '../responses.js';
import {
  sanitizeString, validateAccountId, validateFieldMap, validateIssueKey, validateMaxResults,
  validateProjectKey, validateSafeParam,
} from '../validation.js';
import {
  applyOptionalFields, convertDocFields, dryRunResult, fetchIssueTypes, postIssue, putIssue,
  resolveIssueTypeValue, resolvePriorityValue, safeCreateMeta,
} from '../meta.js';
import { describeTransitions, fetchTransitions, postTransition, resolveTransition } from '../transitions.js';
import { issueSnapshot, mapCustomFields, mapIssue, namesOf, simplifyFieldValue } from '../mappers.js';

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

export function validateFieldSelection(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('fields must be a non-empty array of field IDs (e.g. ["summary", "customfield_10122"] or ["*all"])');
  }
  if (input.length > 50) {
    throw new Error('fields accepts at most 50 entries');
  }
  return input.map((item, index) => {
    const value = sanitizeString(item, 64, `fields[${index}]`);
    if (!/^[*a-zA-Z0-9_-]+$/.test(value)) {
      throw new Error(`Invalid field ID "${value}": use plain field IDs like "summary", "customfield_10122", "*all"`);
    }
    return value;
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
  validateIssueKey(a.issueKey);
  await jiraApi.delete(`/issue/${a.issueKey}`);
  return createSuccessResponse({ success: true, message: `Issue ${a.issueKey} deleted successfully` });
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
  const { maxResults = 50 } = a;
  const issueKey = validateIssueKey(a.issueKey);
  const validatedMaxResults = validateMaxResults(maxResults);

  const response = await jiraApi.get(`/issue/${issueKey}/changelog`, {
    params: { maxResults: validatedMaxResults },
  });

  const histories: JiraChangelogHistory[] = response.data.values ?? [];
  return createSuccessResponse({
    issueKey,
    total: response.data.total ?? histories.length,
    histories: histories.map(h => ({
      id: h.id,
      author: h.author?.displayName,
      created: h.created,
      items: (h.items ?? []).map(item => ({
        field: item.field,
        from: item.fromString,
        to: item.toString,
      })),
    })),
  });
}
