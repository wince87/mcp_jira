import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(TEST_DIR, '__snapshots__');
const REPO_ROOT = dirname(TEST_DIR);
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

function load(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function save(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function normalize(value) {
  // The mock listens on an ephemeral port and the repo lives at a
  // machine-specific path; both must not leak into committed snapshots
  // or CI diverges from every dev machine.
  const rootPattern = new RegExp(REPO_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return JSON.parse(
    JSON.stringify(value)
      .replace(/https:\\?\/\\?\/127\.0\.0\.1:\d+/g, 'https://jira.test')
      .replace(rootPattern, '<repo>'),
  );
}

export function matchSnapshot(name, rawValue) {
  const file = join(SNAPSHOT_DIR, `${name}.json`);
  const value = normalize(rawValue);
  const existing = load(file);

  if (existing === null || UPDATE) {
    save(file, value);
    return;
  }

  assert.deepStrictEqual(
    value,
    existing,
    `Snapshot "${name}" changed. If this is intentional, rerun with UPDATE_SNAPSHOTS=1 and review the diff.`,
  );
}

export function requestTrace(requests) {
  return requests.map(r => {
    const entry = { method: r.method, path: r.path };
    const query = { ...r.query };
    if (Object.keys(query).length > 0) entry.query = query;
    if (r.body !== null && r.body !== undefined) entry.body = r.body;
    return entry;
  });
}
