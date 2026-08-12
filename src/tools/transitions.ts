import type { CreateMetaField, JiraTransition, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { createSuccessResponse } from '../responses.js';
import { validateIssueKey } from '../validation.js';
import { describeMetaField } from '../meta.js';
import { defineTool } from '../registry.js';

export async function handleListTransitions(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const includeFields = a.includeFields === true;
  const params = includeFields ? { expand: 'transitions.fields' } : {};
  const response = await jiraApi.get(`/issue/${issueKey}/transitions`, { params });
  const transitions: (JiraTransition & { fields?: Record<string, CreateMetaField> })[] = response.data.transitions ?? [];

  return createSuccessResponse({
    issueKey,
    transitions: transitions.map(t => {
      const entry: Record<string, unknown> = {
        id: t.id,
        name: t.name,
        to: { id: t.to?.id, name: t.to?.name, category: t.to?.statusCategory?.name },
      };
      if (includeFields) {
        const fields = Object.entries(t.fields ?? {}).map(([fieldId, field]) => describeMetaField({ ...field, fieldId }));
        entry.fields = fields;
        entry.requiredFields = fields.filter(f => f.required === true).map(f => f.fieldId);
      }
      return entry;
    }),
  });
}

export const ListTransitionsTool = defineTool({
  name: 'jira_list_transitions',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description: 'Get available status transitions for a Jira issue. Each entry has the transition id and name plus the target status under "to" — a workflow can name a transition "Start work" while its target status is "In Progress". Set includeFields to also get the fields each transition screen accepts, with required flags and allowed values, for passing via jira_update_issue transitionFields.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      issueKey: { type: 'string', description: 'Issue key (e.g., TTC-123)' },
      includeFields: { type: 'boolean', description: 'When true, expand each transition with its screen fields (fieldId, name, required, type, allowedValues) and a requiredFields shortlist.', default: false },
    },
    required: ['issueKey'],
  },
  handler: handleListTransitions,
});

export const TRANSITIONS_TOOLS = [
  ListTransitionsTool,
];
