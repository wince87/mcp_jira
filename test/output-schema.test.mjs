import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-jira.mjs';
import { startServer } from './client.mjs';
import { validate } from './validate-schema.mjs';

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '__snapshots__', 'tool');

let mock;
let server;
let tools;

before(async () => {
  mock = await startMock();
  server = await startServer({ url: mock.url });
  tools = (await server.listTools()).tools;
});

after(async () => {
  server?.stop();
  await mock?.stop();
});

function recordedResponsesFor(toolName) {
  return readdirSync(SNAPSHOT_DIR)
    .filter(file => file === `${toolName}.json` || file.startsWith(`${toolName}__`))
    .map(file => ({ file, snapshot: JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), 'utf8')) }))
    .filter(({ snapshot }) => snapshot.isError === false);
}

test('every declared outputSchema matches every recorded response', () => {
  const failures = [];
  for (const tool of tools.filter(t => t.outputSchema)) {
    for (const { file, snapshot } of recordedResponsesFor(tool.name)) {
      const errors = validate(tool.outputSchema, snapshot.data);
      if (errors.length > 0) failures.push(`${file}: ${errors.join('; ')}`);
    }
  }
  assert.deepStrictEqual(failures, [], 'a declared outputSchema that its own responses violate breaks strict clients');
});

test('a successful call returns structuredContent', async () => {
  const result = await server.call('jira_get_issue', { issueKey: 'TEST-1' });
  assert.ok(result.structuredContent, 'clients that prefer structured output need it on every success');
  assert.equal(result.structuredContent.key, 'TEST-1');
});

test('structuredContent carries the same data as the text block', async () => {
  const result = await server.call('jira_search_issues', { jql: 'project = TEST' });
  const fromText = result.data;
  assert.deepStrictEqual(result.structuredContent, fromText, 'the two representations must not drift apart');
});

test('a tool that returns images still carries structuredContent', async () => {
  const result = await server.call('jira_get_issue', { issueKey: 'TEST-1', includeImages: true });
  assert.ok(result.content.some(c => c.type === 'image'));
  assert.equal(result.structuredContent.key, 'TEST-1');
});

test('a declared outputSchema is a JSON Schema object', () => {
  for (const tool of tools.filter(t => t.outputSchema)) {
    assert.equal(tool.outputSchema.type, 'object', `${tool.name} outputSchema must describe an object`);
    assert.equal(typeof tool.outputSchema.properties, 'object', `${tool.name} outputSchema needs properties`);
  }
});

test('the tools carrying an outputSchema are the ones with a stable shape', () => {
  const declared = tools.filter(t => t.outputSchema).map(t => t.name).sort();
  assert.ok(declared.length >= 40, `expected most tools to declare an output shape, got ${declared.length}`);
  for (const name of ['jira_get_issue', 'jira_search_issues', 'jira_get_create_fields', 'jira_list_transitions']) {
    assert.ok(declared.includes(name), `${name} has a well-known shape and should declare it`);
  }
});
