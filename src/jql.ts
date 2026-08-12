import { sanitizeString } from './validation.js';

export function quoteJqlValue(value: unknown, fieldName: string, maxLength: number = 255): string {
  const raw = sanitizeString(value, maxLength, fieldName);
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface JqlParts {
  clauses: string[];
  orderBy?: string;
}

export function buildJql({ clauses, orderBy }: JqlParts): string {
  const where = clauses.filter(Boolean).join(' AND ');
  return orderBy ? `${where} ORDER BY ${orderBy}` : where;
}

export function equalsClause(field: string, value: unknown, fieldName: string): string {
  return `${field} = ${quoteJqlValue(value, fieldName)}`;
}
