import type { ToolHandler } from './types.js';

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  handler: ToolHandler;
}

export function defineTool(definition: ToolDefinition): ToolDefinition {
  return definition;
}

export function listedTools(definitions: ToolDefinition[]): Record<string, unknown>[] {
  return definitions.map(({ name, description, inputSchema, outputSchema, annotations }) => {
    const listed: Record<string, unknown> = { name, description, inputSchema };
    if (outputSchema) listed.outputSchema = outputSchema;
    if (annotations) listed.annotations = annotations;
    return listed;
  });
}

export function handlerMap(definitions: ToolDefinition[]): Record<string, ToolHandler> {
  const map: Record<string, ToolHandler> = {};
  for (const definition of definitions) {
    if (map[definition.name]) {
      throw new Error(`Duplicate tool definition: ${definition.name}`);
    }
    map[definition.name] = definition.handler;
  }
  return map;
}
