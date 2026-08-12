import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { JIRA_MAX_RETRIES, JIRA_RETRY_BASE_MS } from './config.js';

const RETRYABLE_SERVER_STATUS = new Set([500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_HONOURED_RETRY_AFTER_MS = 60_000;

interface RetryableConfig extends InternalAxiosRequestConfig {
  retryAttempt?: number;
}

export function parseRetryAfter(value: unknown, now: number = Date.now()): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

function backoffDelay(attempt: number): number {
  const exponential = JIRA_RETRY_BASE_MS * 2 ** attempt;
  const jitter = Math.random() * JIRA_RETRY_BASE_MS;
  return Math.min(exponential + jitter, MAX_RETRY_DELAY_MS);
}

export function shouldRetry(error: AxiosError, attempt: number): number | null {
  if (attempt >= JIRA_MAX_RETRIES) return null;

  const status = error.response?.status;
  const isRead = (error.config?.method ?? 'get').toLowerCase() === 'get';

  if (status === 429) {
    const retryAfter = parseRetryAfter(error.response?.headers?.['retry-after']);
    if (retryAfter !== null && retryAfter > MAX_HONOURED_RETRY_AFTER_MS) return null;
    return retryAfter ?? backoffDelay(attempt);
  }

  if (!isRead) return null;

  if (status !== undefined) {
    return RETRYABLE_SERVER_STATUS.has(status) ? backoffDelay(attempt) : null;
  }
  return RETRYABLE_NETWORK_CODES.has(error.code ?? '') ? backoffDelay(attempt) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function installRetry(client: AxiosInstance): void {
  client.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    if (!config) throw error;

    const attempt = config.retryAttempt ?? 0;
    const delayMs = shouldRetry(error, attempt);
    if (delayMs === null) throw error;

    config.retryAttempt = attempt + 1;
    await sleep(delayMs);
    return client.request(config);
  });
}
