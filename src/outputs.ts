type Schema = Record<string, unknown>;

const STRING = { type: 'string' } as const;
const NUMBER = { type: 'number' } as const;
const BOOLEAN = { type: 'boolean' } as const;

function object(properties: Record<string, unknown>, required: string[] = []): Schema {
  return { type: 'object', properties, required, additionalProperties: true };
}

function arrayOf(items: unknown): Schema {
  return { type: 'array', items };
}

const USER = {
  type: ['object', 'null'],
  properties: { accountId: STRING, displayName: STRING },
  additionalProperties: true,
} as const;

export const ACK_OUTPUT = object({
  success: BOOLEAN,
  message: STRING,
  url: STRING,
}, ['success']);

const ISSUE_SUMMARY_PROPERTIES = {
  key: STRING,
  summary: STRING,
  status: STRING,
  statusCategory: STRING,
  assignee: USER,
  priority: STRING,
  issueType: STRING,
  parent: { type: ['string', 'null'] },
  labels: arrayOf(STRING),
  storyPoints: { type: ['number', 'null'] },
  created: STRING,
  updated: STRING,
  url: STRING,
};

export const ISSUE_OUTPUT = object({
  ...ISSUE_SUMMARY_PROPERTIES,
  description: STRING,
  resolution: { type: ['string', 'null'] },
  reporter: USER,
  components: arrayOf(STRING),
  versions: arrayOf(STRING),
  fixVersions: arrayOf(STRING),
  links: arrayOf(object({
    id: STRING,
    type: STRING,
    direction: STRING,
    relation: STRING,
    key: STRING,
    summary: STRING,
    status: STRING,
    url: STRING,
  })),
  dueDate: { type: ['string', 'null'] },
  timetracking: { type: ['object', 'null'] },
  customFields: { type: 'object' },
}, ['key', 'url']);

const PAGE_PROPERTIES = {
  returned: NUMBER,
  hasMore: BOOLEAN,
  startAt: NUMBER,
  total: NUMBER,
  nextPageToken: { type: ['string', 'null'] },
};

export function pagedOutput(collection: string, items: unknown): Schema {
  return object({ ...PAGE_PROPERTIES, [collection]: arrayOf(items) }, [collection]);
}

export const ISSUE_LIST_OUTPUT = pagedOutput('issues', object(ISSUE_SUMMARY_PROPERTIES));

export const CREATED_ISSUE_OUTPUT = object({
  success: BOOLEAN,
  key: STRING,
  id: STRING,
  url: STRING,
  issue: { type: ['object', 'null'] },
  dryRun: BOOLEAN,
  valid: { type: ['boolean', 'null'] },
  missingRequired: arrayOf({ type: 'object' }),
  invalidValues: arrayOf({ type: 'object' }),
  fieldsNotOnScreen: arrayOf(STRING),
  payload: { type: 'object' },
}, []);

export const META_FIELDS_OUTPUT = object({
  projectKey: STRING,
  issueKey: STRING,
  issueType: { type: 'object' },
  requiredFields: arrayOf(STRING),
  editableFields: arrayOf(STRING),
  fields: arrayOf(object({
    fieldId: STRING,
    name: STRING,
    required: BOOLEAN,
    type: STRING,
    itemsType: STRING,
    custom: STRING,
    hasDefaultValue: BOOLEAN,
    allowedValues: {},
    autoCompleteUrl: STRING,
  }, ['fieldId', 'required'])),
}, ['fields']);

export const TRANSITIONS_OUTPUT = object({
  issueKey: STRING,
  transitions: arrayOf(object({
    id: STRING,
    name: STRING,
    to: object({ id: STRING, name: STRING, category: STRING }),
    fields: arrayOf({ type: 'object' }),
    requiredFields: arrayOf(STRING),
  }, ['id', 'name'])),
}, ['transitions']);

export const BULK_RESULT_OUTPUT = object({
  total: NUMBER,
  succeeded: arrayOf({}),
  failed: arrayOf(object({ issueKey: STRING, error: STRING }, ['issueKey', 'error'])),
  successCount: NUMBER,
  failedCount: NUMBER,
}, ['total', 'succeeded', 'failed', 'successCount', 'failedCount']);

export const USER_LIST_OUTPUT = pagedOutput('users', object({
  accountId: STRING,
  displayName: STRING,
  emailAddress: STRING,
  active: BOOLEAN,
  accountType: STRING,
}));

export const COMMENT_LIST_OUTPUT = pagedOutput('comments', object({
  id: STRING,
  author: USER,
  body: STRING,
  created: STRING,
  updated: STRING,
}));

export const WORKLOG_LIST_OUTPUT = pagedOutput('worklogs', object({
  id: STRING,
  author: USER,
  timeSpent: STRING,
  timeSpentSeconds: NUMBER,
  started: STRING,
  comment: STRING,
}));

export const VERSION_LIST_OUTPUT = pagedOutput('versions', object({
  id: STRING,
  name: STRING,
  description: STRING,
  released: BOOLEAN,
  archived: BOOLEAN,
  startDate: { type: ['string', 'null'] },
  releaseDate: { type: ['string', 'null'] },
}));

export const COMPONENT_LIST_OUTPUT = pagedOutput('components', object({
  id: STRING,
  name: STRING,
  description: STRING,
  lead: USER,
  assigneeType: STRING,
}));

export const SPRINT_LIST_OUTPUT = pagedOutput('sprints', object({
  id: NUMBER,
  name: STRING,
  state: STRING,
  startDate: { type: ['string', 'null'] },
  endDate: { type: ['string', 'null'] },
  goal: { type: ['string', 'null'] },
}));

