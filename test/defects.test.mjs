import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-jira.mjs';
import { startServer } from './client.mjs';

let mock;
let server;

before(async () => {
  mock = await startMock();
  server = await startServer({ url: mock.url });
});

after(async () => {
  server?.stop();
  await mock?.stop();
});

beforeEach(() => mock.reset());

test('B1: bulk transition resolves a transition by its target status', async () => {
  const result = await server.call('jira_bulk_transition_issues', {
    issueKeys: ['TEST-1'],
    status: 'To Do',
  });
  assert.deepStrictEqual(result.data.failed, [], 'target status "To Do" must resolve to transition "Back to backlog"');
  assert.equal(result.data.successCount, 1);
  assert.equal(result.data.succeeded[0].transition, 'Back to backlog');
});

test('B1: transitionName stays accepted as an alias for status', async () => {
  const result = await server.call('jira_bulk_transition_issues', {
    issueKeys: ['TEST-1'],
    transitionName: 'Back to backlog',
  });
  assert.equal(result.data.successCount, 1, 'the pre-3.0 transitionName argument must keep working');
});

test('B1: bulk transition reports why a transition could not be resolved', async () => {
  const result = await server.call('jira_bulk_transition_issues', {
    issueKeys: ['TEST-1'],
    status: 'Nonexistent',
  });
  assert.equal(result.data.failedCount, 1);
  assert.match(result.data.failed[0].error, /Back to backlog -> To Do \(id 21\)/, 'the failure must list what was available');
});

test('B1: bulk transition accepts transition screen fields', async () => {
  const result = await server.call('jira_bulk_transition_issues', {
    issueKeys: ['TEST-1'],
    transitionId: '11',
    transitionFields: { customfield_10016: 5 },
  });
  assert.equal(result.data.successCount, 1, 'a transition screen requiring an estimate must be satisfiable');
});

test('B2: get_issue returns issue links the dependency-map prompt can walk', async () => {
  const result = await server.call('jira_get_issue', { issueKey: 'TEST-1' });
  assert.ok(Array.isArray(result.data.links), 'jira-dependency-map prompt depends on links being returned');
  const link = result.data.links[0];
  assert.equal(link.key, 'TEST-2');
  assert.equal(link.direction, 'inward');
  assert.equal(link.relation, 'is blocked by', 'the phrasing must be from this issue\'s point of view');
  assert.equal(link.type, 'Blocks');
  assert.equal(link.id, '20001', 'the link id is what jira_delete_issue_link needs');
  assert.equal(link.summary, 'Blocker');
  assert.equal(link.status, 'In Progress');
});

test('an issue with no links reports an empty list, not undefined', async () => {
  const result = await server.call('jira_get_issue', { issueKey: 'TEST-2' });
  assert.deepStrictEqual(result.data.links, []);
});

test('B3: assignee has one shape across every list tool', async () => {
  const shapes = {};
  for (const [tool, args, key] of [
    ['jira_search_issues', { jql: 'project = TEST' }, 'issues'],
    ['jira_get_user_issues', { accountId: '5b10a2844c20165700ede21g' }, 'issues'],
    ['jira_get_sprint', { sprintId: 10 }, 'issues'],
    ['jira_get_epic_issues', { epicKey: 'TEST-100' }, 'issues'],
    ['jira_search_by_filter', { filterId: '1000' }, 'issues'],
  ]) {
    mock.reset();
    const result = await server.call(tool, args);
    const first = result.data[key][0];
    shapes[tool] = first.assignee === null || first.assignee === undefined
      ? typeof first.assignee
      : Array.isArray(first.assignee) ? 'array' : typeof first.assignee;
  }
  const distinct = new Set(Object.values(shapes));
  assert.equal(distinct.size, 1, `assignee must have one shape everywhere, got ${JSON.stringify(shapes)}`);
});

test('B4: comments page by startAt and report whether more remain', async () => {
  const first = await server.call('jira_get_comments', { issueKey: 'TEST-1', maxResults: 1, orderBy: 'created' });
  assert.equal(first.data.returned, 1);
  assert.equal(first.data.startAt, 0);
  assert.equal(first.data.total, 2);
  assert.equal(first.data.hasMore, true, 'a second comment exists, so hasMore must be true');
  assert.equal(first.data.comments[0].id, '30001');

  mock.reset();
  const second = await server.call('jira_get_comments', { issueKey: 'TEST-1', maxResults: 1, startAt: 1, orderBy: 'created' });
  assert.equal(mock.requests[0].query.startAt, '1', 'startAt must reach the Jira API');
  assert.equal(second.data.comments[0].id, '30002', 'the second page must return the next comment, not the first again');
  assert.equal(second.data.hasMore, false);
});

test('B4: changelog accepts startAt', async () => {
  await server.call('jira_get_changelog', { issueKey: 'TEST-1', startAt: 100 });
  const request = mock.requests.find(r => r.path === '/rest/api/3/issue/TEST-1/changelog');
  assert.equal(request.query.startAt, '100', 'startAt must reach the Jira API');
});

test('B4: startAt is rejected when it is not a non-negative integer', async () => {
  const result = await server.call('jira_get_comments', { issueKey: 'TEST-1', startAt: -1 });
  assert.equal(result.isError, true);
});



test('worklogs are not silently capped when maxResults is omitted', async () => {
  await server.call('jira_get_worklogs', { issueKey: 'TEST-1' });
  const request = mock.requests.find(r => r.path === '/rest/api/3/issue/TEST-1/worklog');
  assert.equal(request.query.maxResults, undefined, 'omitting maxResults must let Jira return every worklog, as before 3.0');
});

test('worklogs still accept an explicit page window', async () => {
  await server.call('jira_get_worklogs', { issueKey: 'TEST-1', maxResults: 10, startAt: 5 });
  const request = mock.requests.find(r => r.path === '/rest/api/3/issue/TEST-1/worklog');
  assert.equal(request.query.maxResults, '10');
  assert.equal(request.query.startAt, '5');
});
