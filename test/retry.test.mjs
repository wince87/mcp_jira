import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-jira.mjs';
import { startServer } from './client.mjs';

let mock;
let server;

before(async () => {
  mock = await startMock();
  server = await startServer({ url: mock.url, env: { JIRA_RETRY_BASE_MS: '1', JIRA_MAX_RETRIES: '2' } });
});

after(async () => {
  server?.stop();
  await mock?.stop();
});

beforeEach(() => mock.reset());

const countOf = (path, method = 'GET') => mock.requests.filter(r => r.path === path && r.method === method).length;

test('a rate-limited read is retried and then succeeds', async () => {
  mock.respondOnce('GET', '/rest/api/3/myself', 429, { errorMessages: ['Rate limit exceeded'] }, { headers: { 'Retry-After': '0' } });
  const result = await server.call('jira_get_myself', {});
  assert.equal(result.isError, false);
  assert.equal(countOf('/rest/api/3/myself'), 2, 'one retry after the 429');
});

test('a rate-limited write is retried too, because 429 means it never ran', async () => {
  mock.respondOnce('PUT', '/rest/api/3/issue/TEST-1', 429, { errorMessages: ['Rate limit exceeded'] }, { headers: { 'Retry-After': '0' } });
  const result = await server.call('jira_update_issue', { issueKey: 'TEST-1', summary: 'Renamed' });
  assert.equal(result.isError, false);
  assert.equal(countOf('/rest/api/3/issue/TEST-1', 'PUT'), 2);
});

test('retrying stops at JIRA_MAX_RETRIES and surfaces the error', async () => {
  mock.respondOnce('GET', '/rest/api/3/myself', 429, { errorMessages: ['Rate limit exceeded'] }, { times: 99, headers: { 'Retry-After': '0' } });
  const result = await server.call('jira_get_myself', {});
  assert.equal(result.isError, true, 'the caller must eventually learn it failed');
  assert.equal(countOf('/rest/api/3/myself'), 3, 'initial attempt plus JIRA_MAX_RETRIES=2');
});

test('a Retry-After longer than a minute fails fast instead of hanging the agent', async () => {
  mock.respondOnce('GET', '/rest/api/3/myself', 429, { errorMessages: ['Rate limit exceeded'] }, { headers: { 'Retry-After': '600' } });
  const started = Date.now();
  const result = await server.call('jira_get_myself', {});
  assert.equal(result.isError, true);
  assert.ok(Date.now() - started < 5000, 'must not sleep for the full Retry-After window');
  assert.equal(countOf('/rest/api/3/myself'), 1, 'no retry attempted');
});

test('a read is retried on 5xx', async () => {
  mock.respondOnce('GET', '/rest/api/3/myself', 503, { errorMessages: ['Service unavailable'] });
  const result = await server.call('jira_get_myself', {});
  assert.equal(result.isError, false);
  assert.equal(countOf('/rest/api/3/myself'), 2);
});

test('a create is NOT retried on 5xx, because the issue may already exist', async () => {
  mock.respondOnce('POST', '/rest/api/3/issue', 503, { errorMessages: ['Service unavailable'] });
  const result = await server.call('jira_create_issue', { summary: 'x', description: 'y' });
  assert.equal(result.isError, true);
  assert.equal(countOf('/rest/api/3/issue', 'POST'), 1, 'retrying a create on 5xx risks a duplicate issue');
});

test('a delete is NOT retried on 5xx', async () => {
  mock.respondOnce('DELETE', '/rest/api/3/issue/TEST-2', 500, { errorMessages: ['Internal error'] });
  const result = await server.call('jira_delete_issue', { issueKey: 'TEST-2' });
  assert.equal(result.isError, true);
  assert.equal(countOf('/rest/api/3/issue/TEST-2', 'DELETE'), 1);
});

test('a 4xx that is not 429 is never retried', async () => {
  const result = await server.call('jira_get_issue', { issueKey: 'MISSING-1' });
  assert.equal(result.isError, true);
  assert.equal(countOf('/rest/api/3/issue/MISSING-1'), 1);
});

test('bulk transition reports results in input order under concurrency', async () => {
  const keys = ['TEST-1', 'TEST-2', 'TEST-3', 'TEST-4', 'TEST-5', 'TEST-6'];
  const result = await server.call('jira_bulk_transition_issues', { issueKeys: keys, status: 'To Do' });
  assert.equal(result.data.total, 6);
  const reported = [...result.data.succeeded, ...result.data.failed].map(r => r.issueKey);
  assert.deepStrictEqual(result.data.succeeded.map(r => r.issueKey), keys, 'order must follow the input, not completion');
  assert.equal(new Set(reported).size, 6, 'every issue must appear exactly once');
});
