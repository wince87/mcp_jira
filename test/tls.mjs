import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const CERT_DIR = join(dirname(fileURLToPath(import.meta.url)), '.tmp');
const KEY_PATH = join(CERT_DIR, 'key.pem');
const CERT_PATH = join(CERT_DIR, 'cert.pem');

let cached = null;

export async function ensureTestCert() {
  if (cached) return cached;

  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    await mkdir(CERT_DIR, { recursive: true });
    await run('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', KEY_PATH, '-out', CERT_PATH,
      '-days', '3650', '-nodes', '-subj', '/CN=127.0.0.1',
    ]);
  }

  cached = {
    key: await readFile(KEY_PATH),
    cert: await readFile(CERT_PATH),
  };
  return cached;
}
