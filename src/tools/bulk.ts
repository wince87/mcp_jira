import type { AxiosError } from 'axios';
import type { JiraIssue, JiraIssuePayload, BulkIssueInput, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { createADFDocument } from '../adf.js';
import { createIssueUrl, createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateIssueKey, validateSafeParam } from '../validation.js';
import { applyOptionalFields, resolveIssueTypeValue, safeCreateMeta } from '../meta.js';

export async function handleBulkCreateIssues(a: ToolArgs): Promise<ToolResponse> {
  const { issues } = a;
  const projectKey = resolveProjectKey(a);

  if (!Array.isArray(issues) || issues.length === 0) {
    throw new Error('issues must be a non-empty array');
  }
  if (issues.length > 50) {
    throw new Error('Maximum 50 issues per bulk create');
  }

  const issueList: JiraIssuePayload[] = [];
  for (const issue of issues as BulkIssueInput[]) {
    const issueType = validateSafeParam(issue.issueType ?? 'Task', 'issueType');
    const meta = await safeCreateMeta(projectKey, issueType);
    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary: sanitizeString(issue.summary, 500, 'summary'),
      description: createADFDocument(issue.description),
      issuetype: await resolveIssueTypeValue(issueType, projectKey),
    };
    await applyOptionalFields(issue as Record<string, unknown>, fields, meta);
    issueList.push({ fields });
  }

  const response = await jiraApi.post('/issue/bulk', { issueUpdates: issueList });

  const created: JiraIssue[] = response.data.issues ?? [];
  return createSuccessResponse({
    created: created.map(issue => ({
      key: issue.key,
      id: issue.id,
      url: createIssueUrl(issue.key),
    })),
    errors: response.data.errors || [],
  });
}

export async function handleBulkTransitionIssues(a: ToolArgs): Promise<ToolResponse> {
  const { issueKeys, transitionId, transitionName, comment } = a;
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) {
    throw new Error('issueKeys must be a non-empty array');
  }
  if (!transitionId && !transitionName) {
    throw new Error('Either transitionId or transitionName is required');
  }
  const validatedKeys = issueKeys.map(k => validateIssueKey(k));
  const resolvedId = transitionId !== undefined && transitionId !== null
    ? validateSafeParam(transitionId, 'transitionId', 30)
    : null;
  const resolvedName = transitionName !== undefined && transitionName !== null
    ? sanitizeString(transitionName, 100, 'transitionName')
    : null;
  const commentADF = comment !== undefined && comment !== null
    ? createADFDocument(sanitizeString(comment, 5000, 'comment'))
    : null;

  const succeeded: string[] = [];
  const failed: { issueKey: string; error: string }[] = [];

  for (const issueKey of validatedKeys) {
    try {
      let effectiveId = resolvedId;
      if (!effectiveId && resolvedName) {
        const transitionsRes = await jiraApi.get(`/issue/${issueKey}/transitions`);
        interface TR { id: string; name: string }
        const transitions: TR[] = transitionsRes.data.transitions ?? [];
        const match = transitions.find(t => t.name.toLowerCase() === resolvedName.toLowerCase());
        if (!match) throw new Error(`Transition "${resolvedName}" not available on ${issueKey}`);
        effectiveId = match.id;
      }
      const payload: Record<string, unknown> = { transition: { id: effectiveId } };
      if (commentADF) {
        payload.update = { comment: [{ add: { body: commentADF } }] };
      }
      await jiraApi.post(`/issue/${issueKey}/transitions`, payload);
      succeeded.push(issueKey);
    } catch (err) {
      const axiosErr = err as AxiosError<{ errorMessages?: string[]; errors?: Record<string, string> }>;
      const apiMsg = axiosErr.response?.data?.errorMessages?.join('; ')
        || Object.values(axiosErr.response?.data?.errors ?? {}).join('; ')
        || (err instanceof Error ? err.message : String(err));
      failed.push({ issueKey, error: apiMsg });
    }
  }

  return createSuccessResponse({
    total: validatedKeys.length,
    succeeded,
    failed,
    successCount: succeeded.length,
    failedCount: failed.length,
  });
}
