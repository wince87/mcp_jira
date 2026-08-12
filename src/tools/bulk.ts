import type { AxiosError } from 'axios';
import type { JiraIssue, JiraIssuePayload, BulkIssueInput, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { JiraDiagnosticError } from '../errors.js';
import { describeTransitions, fetchTransitions, postTransition, resolveTransition } from '../transitions.js';
import { createADFDocument } from '../adf.js';
import { createIssueUrl, createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateFieldMap, validateIssueKey, validateSafeParam } from '../validation.js';
import { applyOptionalFields, convertDocFields, resolveIssueTypeValue, safeCreateMeta } from '../meta.js';

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

function describeFailure(error: unknown): string {
  const source = error instanceof JiraDiagnosticError ? error.original : error;
  const axiosError = source as AxiosError<{ errorMessages?: string[]; errors?: Record<string, string> }>;
  return axiosError.response?.data?.errorMessages?.filter(Boolean).join('; ')
    || Object.entries(axiosError.response?.data?.errors ?? {}).map(([field, message]) => `${field}: ${message}`).join('; ')
    || (source instanceof Error ? source.message : String(source));
}

export async function handleBulkTransitionIssues(a: ToolArgs): Promise<ToolResponse> {
  const { issueKeys, transitionId, transitionName, status, comment, transitionFields } = a;
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) {
    throw new Error('issueKeys must be a non-empty array');
  }
  const target = transitionName ?? status;
  if (!transitionId && !target) {
    throw new Error('Either transitionId, status, or transitionName is required');
  }
  const validatedKeys = issueKeys.map(k => validateIssueKey(k));
  const resolvedId = transitionId !== undefined && transitionId !== null
    ? validateSafeParam(transitionId, 'transitionId', 30)
    : null;
  const resolvedTarget = resolvedId ? null : sanitizeString(target, 100, 'status');
  const commentADF = comment !== undefined && comment !== null
    ? createADFDocument(sanitizeString(comment, 5000, 'comment'))
    : null;
  const screenFields = transitionFields !== undefined && transitionFields !== null
    ? await convertDocFields(validateFieldMap(transitionFields, 'transitionFields'), null)
    : null;

  const succeeded: { issueKey: string; transition: string; to?: string }[] = [];
  const failed: { issueKey: string; error: string }[] = [];

  for (const issueKey of validatedKeys) {
    try {
      const transitions = await fetchTransitions(issueKey);
      const transition = resolveTransition(transitions, { id: resolvedId, status: resolvedTarget });
      if (!transition) {
        throw new Error(
          `No transition matching "${resolvedId ?? resolvedTarget}" on ${issueKey}. Available: ${describeTransitions(transitions)}`,
        );
      }

      const payload: Record<string, unknown> = { transition: { id: transition.id } };
      if (screenFields) payload.fields = screenFields;
      if (commentADF) payload.update = { comment: [{ add: { body: commentADF } }] };

      await postTransition(issueKey, transition.id, payload);
      succeeded.push({ issueKey, transition: transition.name, to: transition.to?.name });
    } catch (error) {
      failed.push({ issueKey, error: describeFailure(error) });
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
