import type { AxiosError } from 'axios';
import type { ToolResponse } from './types.js';

export class JiraDiagnosticError extends Error {
  constructor(readonly original: unknown, readonly diagnostics: Record<string, unknown>) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'JiraDiagnosticError';
  }
}

export function handleError(error: unknown): ToolResponse {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const source = error instanceof JiraDiagnosticError ? error.original : error;
  const axiosError = source as AxiosError<{ errorMessages?: string[]; errors?: Record<string, string> }>;

  const jiraErrors = axiosError.response?.data?.errorMessages;
  const jiraFieldErrors = axiosError.response?.data?.errors;

  const errorResponse: Record<string, unknown> = {
    error: 'Operation failed',
    message: (source instanceof Error ? source.message : undefined) || 'An unexpected error occurred',
  };

  if (jiraErrors?.length) {
    errorResponse.jiraErrors = jiraErrors;
  }
  if (jiraFieldErrors && Object.keys(jiraFieldErrors).length > 0) {
    errorResponse.fieldErrors = jiraFieldErrors;
  }
  if (error instanceof JiraDiagnosticError) {
    Object.assign(errorResponse, error.diagnostics);
  }

  if (isDevelopment && source instanceof Error) {
    errorResponse.stack = source.stack;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(errorResponse, null, 2),
    }],
    isError: true,
  };
}
