import type { CreateMetaField, JiraTransition, ToolArgs, ToolResponse } from '../types.js';
import { jiraApi } from '../http.js';
import { createSuccessResponse } from '../responses.js';
import { validateIssueKey } from '../validation.js';
import { describeMetaField } from '../meta.js';

export function findTransition(transitions: JiraTransition[], status: string): JiraTransition | undefined {
  const wanted = status.trim().toLowerCase();
  return transitions.find(t => (t.to?.name ?? '').trim().toLowerCase() === wanted)
    ?? transitions.find(t => (t.name ?? '').trim().toLowerCase() === wanted);
}

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
