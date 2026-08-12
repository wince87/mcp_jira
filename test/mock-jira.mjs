import { createServer } from 'node:https';
import { once } from 'node:events';
import { ensureTestCert } from './tls.mjs';

const PROJECT = 'TEST';

const USER = {
  accountId: '5b10a2844c20165700ede21g',
  displayName: 'Vova Press',
  emailAddress: 'vova@example.com',
  active: true,
  accountType: 'atlassian',
  timeZone: 'Europe/Kyiv',
  locale: 'uk_UA',
};

const OTHER_USER = {
  accountId: '5b10a2844c20165700ede21h',
  displayName: 'Olena Q',
  emailAddress: 'olena@example.com',
  active: true,
  accountType: 'atlassian',
};

const ISSUE_TYPES = [
  { id: '10001', name: 'Task', subtask: false, description: 'A task' },
  { id: '10002', name: 'Story', subtask: false, description: 'A story' },
  { id: '10004', name: 'Помилка', subtask: false, description: 'A bug (localized name)' },
  { id: '10005', name: 'Підзавдання', subtask: true, description: 'A subtask (localized name)' },
  { id: '10006', name: 'Epic', subtask: false, description: 'An epic' },
];

const PRIORITIES = [
  { id: '1', name: 'Найвищий', description: 'Highest, localized' },
  { id: '2', name: 'Високий', description: 'High, localized' },
  { id: '3', name: 'Середній', description: 'Medium, localized' },
];

const FIELDS = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
  { id: 'customfield_10016', name: 'Story point estimate', custom: true, schema: { type: 'number' } },
  { id: 'customfield_10011', name: 'Epic Name', custom: true, schema: { type: 'string' } },
  { id: 'customfield_10500', name: 'For QA', custom: true, schema: { type: 'doc', custom: 'rich-text' } },
  { id: 'customfield_10122', name: 'Type of Team', custom: true, schema: { type: 'option' } },
];

function createMetaFields(typeId) {
  const base = [
    { fieldId: 'project', name: 'Project', required: true, hasDefaultValue: false, schema: { type: 'project' } },
    { fieldId: 'issuetype', name: 'Issue Type', required: true, hasDefaultValue: false, schema: { type: 'issuetype' } },
    { fieldId: 'summary', name: 'Summary', required: true, hasDefaultValue: false, schema: { type: 'string' } },
    { fieldId: 'description', name: 'Description', required: false, schema: { type: 'doc' } },
    { fieldId: 'labels', name: 'Labels', required: false, schema: { type: 'array', items: 'string' } },
    {
      fieldId: 'priority', name: 'Пріоритет', required: false, hasDefaultValue: true,
      schema: { type: 'priority' },
      allowedValues: PRIORITIES.map(p => ({ id: p.id, name: p.name })),
    },
    { fieldId: 'customfield_10016', name: 'Story point estimate', required: false, schema: { type: 'number' } },
  ];
  if (typeId === '10004') {
    base.push(
      {
        fieldId: 'versions', name: 'Affects versions', required: true, hasDefaultValue: false,
        schema: { type: 'array', items: 'version' },
        allowedValues: [{ id: '10100', name: '1.0' }, { id: '10101', name: '1.1' }],
      },
      { fieldId: 'customfield_10500', name: 'For QA', required: true, hasDefaultValue: false, schema: { type: 'doc', custom: 'rich-text' } },
    );
  }
  if (typeId === '10006') {
    base.push({ fieldId: 'customfield_10011', name: 'Epic Name', required: true, hasDefaultValue: false, schema: { type: 'string' } });
  }
  if (typeId === '10005') {
    base.push({ fieldId: 'parent', name: 'Parent', required: true, hasDefaultValue: false, schema: { type: 'issuelink' } });
  }
  return base;
}

function adf(text) {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

const ISSUES = {
  'TEST-1': {
    id: '10001',
    key: 'TEST-1',
    fields: {
      summary: 'Broken login',
      description: adf('Login fails on retry'),
      status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
      resolution: null,
      assignee: USER,
      reporter: OTHER_USER,
      priority: { name: 'Високий' },
      issuetype: { name: 'Помилка', subtask: false },
      project: { key: PROJECT },
      labels: ['regression'],
      versions: [{ id: '10100', name: '1.0' }],
      fixVersions: [{ id: '10101', name: '1.1' }],
      components: [{ id: '10200', name: 'Auth' }],
      duedate: '2026-09-01',
      timetracking: { originalEstimate: '3h', remainingEstimate: '2h' },
      created: '2026-08-01T10:00:00.000+0000',
      updated: '2026-08-02T10:00:00.000+0000',
      customfield_10016: 3,
      customfield_10500: adf('QA notes'),
      customfield_10122: { value: 'Platform' },
      issuelinks: [
        {
          id: '20001',
          type: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          inwardIssue: { key: 'TEST-2', fields: { summary: 'Blocker', status: { name: 'In Progress' } } },
        },
      ],
      attachment: [
        {
          id: '9001', filename: 'screen.png', size: 1024, mimeType: 'image/png',
          created: '2026-08-01T11:00:00.000+0000', author: USER,
          content: 'https://mock/attachment/content/9001',
        },
      ],
    },
  },
  'TEST-2': {
    id: '10002',
    key: 'TEST-2',
    fields: {
      summary: 'Blocker task',
      description: adf('Blocks the login fix'),
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      resolution: null,
      assignee: null,
      reporter: USER,
      priority: { name: 'Середній' },
      issuetype: { name: 'Task', subtask: false },
      project: { key: PROJECT },
      labels: [],
      created: '2026-08-01T09:00:00.000+0000',
      updated: '2026-08-01T09:30:00.000+0000',
    },
  },
  'TEST-100': {
    id: '10100',
    key: 'TEST-100',
    fields: {
      summary: 'Auth epic',
      description: adf('All auth work'),
      status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
      resolution: null,
      assignee: null,
      reporter: USER,
      priority: { name: 'Високий' },
      issuetype: { name: 'Epic', subtask: false },
      project: { key: PROJECT },
      labels: ['epic'],
      created: '2026-07-01T09:00:00.000+0000',
      updated: '2026-08-01T09:00:00.000+0000',
      customfield_10011: 'Auth',
    },
  },
};

const TRANSITIONS = [
  {
    id: '11',
    name: 'Start work (estimate)',
    to: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
    fields: {
      customfield_10016: { fieldId: 'customfield_10016', name: 'Story point estimate', required: true, schema: { type: 'number' } },
    },
  },
  {
    id: '21',
    name: 'Back to backlog',
    to: { id: '1', name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
    fields: {},
  },
];

const COMMENTS = [
  { id: '30001', author: USER, body: adf('First comment'), created: '2026-08-01T12:00:00.000+0000', updated: '2026-08-01T12:00:00.000+0000' },
  { id: '30002', author: OTHER_USER, body: adf('Second comment'), created: '2026-08-02T12:00:00.000+0000', updated: '2026-08-02T12:00:00.000+0000' },
];

const WORKLOGS = [
  { id: '40001', author: USER, timeSpent: '2h', timeSpentSeconds: 7200, started: '2026-08-01T09:00:00.000+0000', comment: adf('Investigated') },
];

const CHANGELOG = [
  {
    id: '50001', author: USER, created: '2026-08-02T10:00:00.000+0000',
    items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }],
  },
];

const VERSIONS = [
  { id: '10100', name: '1.0', description: 'First', released: true, archived: false, releaseDate: '2026-06-01', startDate: '2026-05-01' },
  { id: '10101', name: '1.1', description: 'Next', released: false, archived: false, releaseDate: '2026-10-01', startDate: '2026-08-01' },
];

const COMPONENTS = [
  { id: '10200', name: 'Auth', description: 'Authentication', lead: USER, assigneeType: 'PROJECT_LEAD' },
];

const BOARDS = [{ id: 1, name: 'TEST board', type: 'scrum', location: { projectKey: PROJECT, projectName: 'Test project' } }];

const SPRINTS = [
  { id: 10, name: 'Sprint 1', state: 'active', startDate: '2026-08-01T00:00:00.000Z', endDate: '2026-08-14T00:00:00.000Z', goal: 'Ship auth' },
];

const FILTERS = [
  { id: '1000', name: 'My open bugs', description: 'Open bugs', jql: 'project = TEST AND issuetype = Bug', owner: USER, favourite: true, favouritedCount: 2, viewUrl: 'https://mock/filter/1000' },
];

const ATTACHMENT_BYTES = Buffer.from('89504e470d0a1a0a', 'hex');

function projectPayload() {
  return {
    id: '10000', key: PROJECT, name: 'Test project', description: 'Mock project',
    lead: USER, url: 'https://mock/browse/TEST', projectTypeKey: 'software', style: 'classic',
  };
}

function page(items, query, key) {
  const startAt = Number(query.startAt ?? 0);
  const maxResults = Number(query.maxResults ?? 50);
  const slice = items.slice(startAt, startAt + maxResults);
  return { [key]: slice, startAt, maxResults, total: items.length, isLast: startAt + slice.length >= items.length };
}

function issueList(keys) {
  return keys.map(k => ISSUES[k]).filter(Boolean);
}

function pick(issue, fieldsParam) {
  if (!fieldsParam) return issue;
  const wanted = fieldsParam.split(',').map(s => s.trim());
  if (wanted.includes('*all')) return issue;
  const fields = {};
  for (const name of wanted) {
    if (name in issue.fields) fields[name] = issue.fields[name];
  }
  return { id: issue.id, key: issue.key, fields };
}

const ROUTES = [
  ['GET', '/rest/api/3/myself', () => [200, USER]],
  ['GET', '/rest/api/3/field', () => [200, FIELDS]],
  ['GET', '/rest/api/3/label', (p, q) => [200, page(['regression', 'epic', 'blocked'], q, 'values')]],
  ['GET', '/rest/api/3/mypermissions', (p, q) => [200, {
    permissions: Object.fromEntries((q.permissions ?? '').split(',').filter(Boolean)
      .map(key => [key, { key, name: key, havePermission: key !== 'DELETE_ISSUES' }])),
  }]],
  ['DELETE', '/rest/api/3/attachment/:id', () => [204, null]],
  ['GET', '/rest/api/3/priority/search', () => [200, { values: PRIORITIES, total: PRIORITIES.length, isLast: true }]],
  ['GET', '/rest/api/3/issueLinkType', () => [200, { issueLinkTypes: [{ id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }] }]],

  ['GET', '/rest/api/3/issue/createmeta/:key/issuetypes/:typeId', (p) => [200, { fields: createMetaFields(p.typeId), total: 8, maxResults: 200, startAt: 0 }]],
  ['GET', '/rest/api/3/issue/createmeta/:key/issuetypes', () => [200, { values: ISSUE_TYPES, total: ISSUE_TYPES.length, maxResults: 200, startAt: 0 }]],

  ['GET', '/rest/api/3/project/search', (p, q) => [200, page([projectPayload()], q, 'values')]],
  ['POST', '/rest/api/3/version/:id/removeAndSwap', () => [204, null]],
  ['POST', '/rest/api/3/version', (p, q, body) => [201, { id: '10102', archived: false, released: false, ...body }]],
  ['PUT', '/rest/api/3/version/:id', (p, q, body) => [200, { ...VERSIONS[1], id: p.id, ...body }]],
  ['POST', '/rest/api/3/component', (p, q, body) => [201, { id: '10201', ...body, lead: body.leadAccountId ? USER : undefined }]],
  ['PUT', '/rest/api/3/component/:id', (p, q, body) => [200, { ...COMPONENTS[0], id: p.id, ...body }]],
  ['DELETE', '/rest/api/3/component/:id', () => [204, null]],
  ['GET', '/rest/api/3/project/:key/statuses', () => [200, [
    { id: '10004', name: 'Помилка', statuses: [{ id: '1', name: 'To Do', statusCategory: { key: 'new' } }, { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } }] },
  ]]],
  ['GET', '/rest/api/3/project/:key/components', () => [200, COMPONENTS]],
  ['GET', '/rest/api/3/project/:key/versions', () => [200, VERSIONS]],
  ['GET', '/rest/api/3/project/:key', () => [200, projectPayload()]],

  ['GET', '/rest/api/3/search/jql', (p, q) => {
    const jql = q.jql ?? '';
    let keys = ['TEST-1', 'TEST-2'];
    if (/issuetype\s*=\s*Epic/i.test(jql)) keys = ['TEST-100'];
    else if (/assignee/i.test(jql)) keys = ['TEST-1'];
    return [200, { issues: issueList(keys).map(i => pick(i, q.fields)), isLast: true, nextPageToken: null }];
  }],
  ['GET', '/rest/api/3/user/search', () => [200, [USER, OTHER_USER]]],

  ['GET', '/rest/api/3/filter/search', (p, q) => [200, page(FILTERS, q, 'values')]],
  ['GET', '/rest/api/3/filter/:id', (p) => {
    const filter = FILTERS.find(f => f.id === p.id);
    return filter ? [200, filter] : [404, { errorMessages: [`Filter ${p.id} not found`] }];
  }],

  ['GET', '/rest/api/3/attachment/content/:id', () => [200, ATTACHMENT_BYTES, 'image/png']],
  ['GET', '/rest/api/3/attachment/:id', (p) => [200, {
    id: p.id, filename: 'screen.png', size: ATTACHMENT_BYTES.length, mimeType: 'image/png', author: USER,
  }]],

  ['GET', '/rest/api/3/issue/:key/changelog', (p, q) => [200, page(CHANGELOG, q, 'values')]],
  ['GET', '/rest/api/3/issue/:key/comment', (p, q) => {
    const ordered = q.orderBy === 'created' ? COMMENTS : [...COMMENTS].reverse();
    return [200, page(ordered, q, 'comments')];
  }],
  ['GET', '/rest/api/3/issue/:key/remotelink/:linkId', () => [404, { errorMessages: ['not used'] }]],
  ['DELETE', '/rest/api/3/issue/:key/remotelink/:linkId', () => [204, null]],
  ['GET', '/rest/api/3/issue/:key/remotelink', () => [200, [
    { id: 60001, globalId: 'pr-42', relationship: 'implemented by', application: { name: 'GitHub' }, object: { url: 'https://github.com/acme/repo/pull/42', title: 'PR #42', summary: 'Fix login retry' } },
  ]]],
  ['POST', '/rest/api/3/issue/:key/remotelink', () => [201, { id: 60002 }]],
  ['GET', '/rest/api/3/issue/:key/editmeta', () => [200, {
    fields: {
      summary: { name: 'Summary', required: true, schema: { type: 'string' }, operations: ['set'] },
      priority: { name: 'Пріоритет', required: false, schema: { type: 'priority' }, allowedValues: PRIORITIES.map(x => ({ id: x.id, name: x.name })) },
    },
  }]],
  ['GET', '/rest/api/3/issue/:key/transitions', (p, q) => {
    const list = q.expand === 'transitions.fields'
      ? TRANSITIONS
      : TRANSITIONS.map(({ fields, ...rest }) => rest);
    return [200, { transitions: q.transitionId ? list.filter(t => t.id === q.transitionId) : list }];
  }],
  ['GET', '/rest/api/3/issue/:key/watchers', () => [200, { isWatching: true, watchCount: 1, watchers: [USER] }]],
  ['GET', '/rest/api/3/issue/:key/worklog', (p, q) => [200, page(WORKLOGS, q, 'worklogs')]],
  ['GET', '/rest/api/3/issue/:key', (p, q) => {
    const issue = ISSUES[p.key];
    return issue ? [200, pick(issue, q.fields)] : [404, { errorMessages: [`Issue ${p.key} does not exist`] }];
  }],

  ['POST', '/rest/api/3/issue/bulk', (p, q, body) => [201, {
    issues: (body.issueUpdates ?? []).map((_, i) => ({ id: String(11000 + i), key: `TEST-${900 + i}` })),
    errors: [],
  }]],
  ['POST', '/rest/api/3/issue/:key/attachments', () => [200, [{
    id: '9002', filename: 'upload.txt', size: 12, mimeType: 'text/plain', content: 'https://mock/attachment/content/9002',
  }]]],
  ['POST', '/rest/api/3/issue/:key/transitions', (p, q, body) => {
    const transition = TRANSITIONS.find(t => t.id === body?.transition?.id);
    if (!transition) return [400, { errorMessages: ['Transition is not valid'], errors: {} }];
    const required = Object.entries(transition.fields ?? {}).filter(([, f]) => f.required).map(([id]) => id);
    const missing = required.filter(id => body?.fields?.[id] === undefined);
    if (missing.length > 0) {
      return [400, { errorMessages: [], errors: Object.fromEntries(missing.map(id => [id, `${id} is required.`])) }];
    }
    return [204, null];
  }],
  ['POST', '/rest/api/3/issue/:key/comment', (p, q, body) => [201, {
    id: '30003', author: USER, body: body.body, created: '2026-08-03T12:00:00.000+0000',
  }]],
  ['POST', '/rest/api/3/issue/:key/watchers', () => [204, null]],
  ['POST', '/rest/api/3/issue/:key/worklog', (p, q, body) => [201, {
    id: '40002', author: USER, timeSpent: body.timeSpent, timeSpentSeconds: 3600, started: body.started ?? '2026-08-03T09:00:00.000+0000',
  }]],
  ['POST', '/rest/api/3/issue', (p, q, body) => {
    const fields = body?.fields ?? {};
    const typeId = fields.issuetype?.id;
    const required = createMetaFields(typeId).filter(f => f.required && !f.hasDefaultValue).map(f => f.fieldId);
    const missing = required.filter(id => fields[id] === undefined);
    if (missing.length > 0) {
      return [400, { errorMessages: [], errors: Object.fromEntries(missing.map(id => [id, `${id} is required.`])) }];
    }
    return [201, { id: '10001', key: 'TEST-1', self: 'https://mock/rest/api/3/issue/10001' }];
  }],
  ['POST', '/rest/api/3/issueLink', () => [201, null]],
  ['DELETE', '/rest/api/3/issueLink/:id', () => [204, null]],

  ['PUT', '/rest/api/3/issue/:key/assignee', () => [204, null]],
  ['PUT', '/rest/api/3/issue/:key/comment/:id', (p, q, body) => [200, {
    id: p.id, author: USER, body: body.body, updated: '2026-08-03T13:00:00.000+0000',
  }]],
  ['PUT', '/rest/api/3/issue/:key/worklog/:id', (p, q, body) => [200, {
    id: p.id, timeSpent: body.timeSpent ?? '2h', started: body.started ?? '2026-08-01T09:00:00.000+0000',
  }]],
  ['PUT', '/rest/api/3/issue/:key', () => [204, null]],

  ['DELETE', '/rest/api/3/issue/:key/comment/:id', () => [204, null]],
  ['DELETE', '/rest/api/3/issue/:key/watchers', () => [204, null]],
  ['DELETE', '/rest/api/3/issue/:key/worklog/:id', () => [204, null]],
  ['DELETE', '/rest/api/3/issue/:key', () => [204, null]],

  ['GET', '/rest/agile/1.0/board/:boardId/epic', (p, q) => [200, page([{ id: 10100, key: 'TEST-100', name: 'Auth', summary: 'Auth epic', done: false, color: { key: 'color_1' } }], q, 'values')]],
  ['GET', '/rest/agile/1.0/board/:boardId/sprint', (p, q) => [200, page(SPRINTS.filter(s => !q.state || s.state === q.state), q, 'values')]],
  ['GET', '/rest/agile/1.0/board', (p, q) => [200, page(BOARDS, q, 'values')]],
  ['POST', '/rest/agile/1.0/sprint/:id', (p, q, body) => [200, { ...SPRINTS[0], id: Number(p.id), ...body }]],
  ['POST', '/rest/agile/1.0/sprint', (p, q, body) => [201, { id: 11, state: 'future', ...body }]],
  ['DELETE', '/rest/agile/1.0/sprint/:id', () => [204, null]],
  ['GET', '/rest/agile/1.0/epic/:key/issue', (p, q) => [200, page(issueList(['TEST-1', 'TEST-2']).map(i => pick(i, q.fields)), q, 'issues')]],
  ['GET', '/rest/agile/1.0/epic/:key', () => [200, {
    id: 10100, key: 'TEST-100', name: 'Auth', summary: 'Auth epic', done: false, color: { key: 'color_1' },
  }]],
  ['GET', '/rest/agile/1.0/sprint/:id/issue', (p, q) => [200, page(issueList(['TEST-1', 'TEST-2']).map(i => pick(i, q.fields)), q, 'issues')]],
  ['GET', '/rest/agile/1.0/sprint/:id', (p) => [200, SPRINTS.find(s => String(s.id) === p.id) ?? SPRINTS[0]]],
  ['PUT', '/rest/agile/1.0/issue/rank', () => [204, null]],
  ['POST', '/rest/agile/1.0/backlog/issue', () => [204, null]],
  ['POST', '/rest/agile/1.0/epic/none/issue', () => [204, null]],
  ['POST', '/rest/agile/1.0/epic/:key/issue', () => [204, null]],
  ['POST', '/rest/agile/1.0/sprint/:id/issue', () => [204, null]],
];

function matchRoute(method, pathname) {
  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (patternParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler, params };
  }
  return null;
}

export async function startMock(options = {}) {
  const { key, cert } = await ensureTestCert();
  const requests = [];
  const overrides = new Map();

  const server = createServer({ key, cert }, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'https://mock');
      const rawBody = Buffer.concat(chunks);
      const isJson = (req.headers['content-type'] ?? '').includes('application/json');
      let body = null;
      if (rawBody.length > 0 && isJson) {
        try {
          body = JSON.parse(rawBody.toString());
        } catch {
          body = rawBody.toString();
        }
      }

      const query = Object.fromEntries(url.searchParams);
      requests.push({ method: req.method, path: url.pathname, query, body });

      const overrideKey = `${req.method} ${url.pathname}`;
      const override = overrides.get(overrideKey);
      if (override) {
        const remaining = override.times - 1;
        if (remaining <= 0) overrides.delete(overrideKey);
        else overrides.set(overrideKey, { ...override, times: remaining });
        res.writeHead(override.status, override.headers ?? { 'Content-Type': 'application/json' });
        res.end(override.body === null ? '' : JSON.stringify(override.body));
        return;
      }

      const route = matchRoute(req.method, url.pathname);
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errorMessages: [`mock: no route for ${req.method} ${url.pathname}`] }));
        return;
      }

      const [status, payload, contentType] = route.handler(route.params, query, body);
      if (payload === null || payload === undefined) {
        res.writeHead(status);
        res.end();
        return;
      }
      if (Buffer.isBuffer(payload)) {
        res.writeHead(status, { 'Content-Type': contentType ?? 'application/octet-stream' });
        res.end(payload);
        return;
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  server.listen(options.port ?? 0, '127.0.0.1');
  await once(server, 'listening');

  return {
    url: `https://127.0.0.1:${server.address().port}`,
    requests,
    reset: () => { requests.length = 0; overrides.clear(); },
    respondOnce: (method, path, status, body, options = {}) => {
      const { times = 1, headers } = options;
      overrides.set(`${method} ${path}`, { status, body, times, headers: headers ? { 'Content-Type': 'application/json', ...headers } : undefined });
    },
    stop: () => new Promise(resolve => server.close(resolve)),
  };
}

export { PROJECT, USER, OTHER_USER, ISSUE_TYPES, PRIORITIES };
