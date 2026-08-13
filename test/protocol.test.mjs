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

test('the server advertises tools, prompts, resources and completions', () => {
  const { capabilities } = server.initializeResult;
  for (const capability of ['tools', 'prompts', 'resources', 'completions']) {
    assert.ok(capabilities[capability], `${capability} must be advertised or clients will not use it`);
  }
});

test('prompts that need input declare arguments', async () => {
  const { prompts } = await server.listPrompts();
  const withArgs = prompts.filter(p => p.arguments?.length);
  assert.ok(withArgs.length >= 20, `expected most prompts to take arguments, got ${withArgs.length}`);

  const dependencyMap = prompts.find(p => p.name === 'jira-dependency-map');
  const issueKey = dependencyMap.arguments.find(arg => arg.name === 'issueKey');
  assert.equal(issueKey.required, true, 'a prompt about one issue cannot run without knowing which');
});

test('a prompt substitutes the project key into its JQL', async () => {
  const result = await server.request('prompts/get', {
    name: 'jira-backlog-grooming',
    arguments: { projectKey: 'OPS' },
  });
  const text = result.result.messages[0].content.text;
  assert.match(text, /project = "OPS"/, 'the placeholder must be replaced, not left as <KEY>');
  assert.ok(!text.includes('<KEY>'), 'no placeholder may survive substitution');
  assert.match(text, /Inputs for this run:\n- projectKey: OPS/);
});

test('a prompt missing a required argument fails loudly', async () => {
  const result = await server.request('prompts/get', { name: 'jira-dependency-map', arguments: {} });
  assert.ok(result.error, 'a missing required argument must not silently render a broken prompt');
  assert.match(JSON.stringify(result.error), /issueKey/);
});

test('a prompt with all arguments renders them into the header', async () => {
  const result = await server.request('prompts/get', {
    name: 'jira-dependency-map',
    arguments: { issueKey: 'TEST-1' },
  });
  assert.match(result.result.messages[0].content.text, /- issueKey: TEST-1/);
});

test('resource templates cover issues, projects, create screens and filters', async () => {
  const result = await server.request('resources/templates/list', {});
  const templates = result.result.resourceTemplates.map(t => t.uriTemplate);
  assert.deepStrictEqual(templates, [
    'jira://issue/{issueKey}',
    'jira://project/{projectKey}',
    'jira://project/{projectKey}/create-fields/{issueType}',
    'jira://filter/{filterId}',
  ]);
});

test('reading an issue resource returns the same shape as the tool', async () => {
  const result = await server.request('resources/read', { uri: 'jira://issue/TEST-1' });
  const contents = result.result.contents[0];
  assert.equal(contents.mimeType, 'application/json');
  const issue = JSON.parse(contents.text);
  assert.equal(issue.key, 'TEST-1');
  assert.equal(issue.summary, 'Broken login');
  assert.ok(Array.isArray(issue.links));
});

test('reading a create-screen resource returns the field metadata', async () => {
  const result = await server.request('resources/read', {
    uri: 'jira://project/TEST/create-fields/%D0%9F%D0%BE%D0%BC%D0%B8%D0%BB%D0%BA%D0%B0',
  });
  const meta = JSON.parse(result.result.contents[0].text);
  assert.equal(meta.issueType.id, '10004', 'a URL-encoded localized issue type must resolve');
  assert.ok(meta.fields.some(f => f.fieldId === 'versions' && f.required));
});

test('resource URIs are validated, not trusted', async () => {
  for (const uri of ['jira://issue/../../etc/passwd', 'jira://project/lower', 'jira://nope/1']) {
    const result = await server.request('resources/read', { uri });
    assert.ok(result.error, `${uri} must be rejected`);
  }
});

test('the static resource list points at the configured project', async () => {
  const result = await server.request('resources/list', {});
  const uris = result.result.resources.map(r => r.uri);
  assert.ok(uris.includes('jira://project/TEST'));
  assert.ok(uris.includes('jira://my-open-issues'));
});

test('my-open-issues scopes the JQL to the authenticated user', async () => {
  await server.request('resources/read', { uri: 'jira://my-open-issues' });
  const search = mock.requests.find(r => r.path === '/rest/api/3/search/jql');
  assert.match(search.query.jql, /assignee = "5b10a2844c20165700ede21g"/);
  assert.match(search.query.jql, /statusCategory != Done/);
});

test('completion suggests project keys filtered by what was typed', async () => {
  const result = await server.request('completion/complete', {
    ref: { type: 'ref/prompt', name: 'jira-backlog-grooming' },
    argument: { name: 'projectKey', value: 'TE' },
  });
  assert.deepStrictEqual(result.result.completion.values, ['TEST']);

  const noMatch = await server.request('completion/complete', {
    ref: { type: 'ref/prompt', name: 'jira-backlog-grooming' },
    argument: { name: 'projectKey', value: 'ZZ' },
  });
  assert.deepStrictEqual(noMatch.result.completion.values, []);
});

test('completion suggests issue types and never throws on an unknown argument', async () => {
  const types = await server.request('completion/complete', {
    ref: { type: 'ref/prompt', name: 'x' },
    argument: { name: 'issueType', value: '' },
  });
  assert.ok(types.result.completion.values.includes('Помилка'));

  const unknown = await server.request('completion/complete', {
    ref: { type: 'ref/prompt', name: 'x' },
    argument: { name: 'nonsense', value: 'a' },
  });
  assert.deepStrictEqual(unknown.result.completion.values, []);
});
