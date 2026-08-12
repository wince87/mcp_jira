import type { AxiosError } from 'axios';
import type { JiraIssue, JiraIssuePayload, BulkIssueInput, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { JIRA_CONCURRENCY } from '../config.js';
import { mapWithConcurrency } from '../concurrency.js';
import { JiraDiagnosticError } from '../errors.js';
import { describeTransitions, fetchTransitions, postTransition, resolveTransition } from '../transitions.js';
import { createADFDocument } from '../adf.js';
import { createIssueUrl, createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateFieldMap, validateIssueKey, validateSafeParam } from '../validation.js';
import { applyOptionalFields, convertDocFields, resolveIssueTypeValue, safeCreateMeta } from '../meta.js';
import { defineTool } from '../registry.js';
import { PRIORITY_SCHEMA, COMMON_ISSUE_FIELDS_SCHEMA } from '../schemas.js';
import { JIRA_PROJECT_KEY } from '../config.js';

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

  const outcomes = await mapWithConcurrency(validatedKeys, JIRA_CONCURRENCY, async (issueKey) => {
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
      return { issueKey, transition: transition.name, to: transition.to?.name };
    } catch (error) {
      return { issueKey, error: describeFailure(error) };
    }
  });

  const succeeded = outcomes.filter((o): o is { issueKey: string; transition: string; to?: string } => !('error' in o));
  const failed = outcomes.filter((o): o is { issueKey: string; error: string } => 'error' in o);

  return createSuccessResponse({
    total: validatedKeys.length,
    succeeded,
    failed,
    successCount: succeeded.length,
    failedCount: failed.length,
  });
}

export const BulkCreateIssuesTool = defineTool({
  name: 'jira_bulk_create_issues',
  description: 'Create multiple Jira issues at once. Descriptions support Markdown, automatically converted to ADF.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issues: {
        type: 'array',
        description: 'Array of issues to create',
        items: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Issue summary/title' },
            description: { type: 'string', description: 'Issue description in Markdown' },
            issueType: { type: 'string', description: 'Issue type name or id (Story, Task, Bug, etc.). Names are resolved to ids.', default: 'Task' },
            priority: PRIORITY_SCHEMA,
            storyPoints: { type: 'number' },
            parent: { type: 'string', description: 'Parent issue key (epic or parent task).' },
            ...COMMON_ISSUE_FIELDS_SCHEMA,
          },
          required: ['summary'],
        },
      },
      projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
    },
    required: ['issues'],
  },
  handler: handleBulkCreateIssues,
});

export const BulkTransitionIssuesTool = defineTool({
  name: 'jira_bulk_transition_issues',
  description: 'Apply the same status transition to multiple issues. Iterates client-side; failures are collected per issue and returned. status is matched against each transition target status first, then transition names, case-insensitively — so "In Progress" works even where the transition is called "Start work". Use transitionFields when the transition screen requires input.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKeys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of issue keys to transition',
      },
      transitionId: { type: 'string', description: 'Exact transition ID from jira_list_transitions. Takes precedence over status.' },
      status: { type: 'string', description: 'Target status name (e.g. "In Progress") or transition name. Resolved per issue.' },
      transitionName: { type: 'string', description: 'Deprecated alias for status, kept for compatibility.' },
      transitionFields: { type: 'object', additionalProperties: true, description: 'Fields required by the transition screen, keyed by field ID. Call jira_list_transitions with includeFields to see what a transition requires.' },
      comment: { type: 'string', description: 'Optional comment added during the transition (Markdown)' },
    },
    required: ['issueKeys'],
  },
  handler: handleBulkTransitionIssues,
});

export const BULK_TOOLS = [
  BulkCreateIssuesTool,
  BulkTransitionIssuesTool,
];
