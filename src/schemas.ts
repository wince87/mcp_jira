export const PRIORITY_SCHEMA = {
  type: 'string',
  description: 'Priority id (preferred) or name. Names are localized on non-English instances and only the canonical English name works — pass the id from jira_get_priorities or jira_get_create_fields. A localized name is matched against the allowed values and converted to an id automatically.',
} as const;

export const CUSTOM_FIELDS_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  description: 'Custom field values keyed by field ID (customfield_NNNNN). Use the shape the field expects: single-select { "id": "10001" } or { "value": "X" }; multi-select [ { "id": "10001" } ]; user { "accountId": "..." }; text "string". Rich-text (schema.type "doc") fields accept a plain Markdown string and are converted to ADF automatically. Call jira_get_create_fields for ids and allowed values.',
} as const;

export const COMMON_ISSUE_FIELDS_SCHEMA = {
  labels: { type: 'array', items: { type: 'string' }, description: 'Labels. Sent only when provided.' },
  versions: { type: 'array', items: { type: 'string' }, description: 'Affects versions, by name or numeric id (ids are used verbatim). Required on many Bug screens. List them with jira_get_project_versions.' },
  fixVersions: { type: 'array', items: { type: 'string' }, description: 'Fix versions, by name or numeric id. List them with jira_get_project_versions.' },
  components: { type: 'array', items: { type: 'string' }, description: 'Components, by name or numeric id. List them with jira_get_project_components.' },
  assignee: { type: 'string', description: 'Assignee accountId (not email). Resolve via jira_search_users or jira_get_myself.' },
  reporter: { type: 'string', description: 'Reporter accountId (not email). Requires the Modify Reporter permission.' },
  dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD.' },
  timetracking: {
    type: 'object',
    properties: {
      originalEstimate: { type: 'string', description: 'Jira duration, e.g. "3h 30m", "2d".' },
      remainingEstimate: { type: 'string', description: 'Jira duration, e.g. "1h".' },
    },
    description: 'Time tracking estimates.',
  },
  customFields: CUSTOM_FIELDS_SCHEMA,
  customFieldsMarkdown: {
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Rich-text custom fields keyed by field ID, values as Markdown strings converted to ADF. Use when the field type is "doc" and you want the conversion to be explicit.',
  },
} as const;
