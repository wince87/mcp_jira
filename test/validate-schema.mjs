function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  const allowed = Array.isArray(expected) ? expected : [expected];
  return allowed.some(type => (
    type === actual
    || (type === 'number' && actual === 'integer')
    || (type === 'integer' && actual === 'integer')
  ));
}

export function validate(schema, value, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${JSON.stringify(schema.type)}, got ${typeOf(value)}`);
    return errors;
  }

  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: required but missing`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value && value[key] !== undefined) {
        errors.push(...validate(child, value[key], `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!known.has(key)) errors.push(`${path}.${key}: not allowed by the schema`);
      }
    }
  }

  if (typeOf(value) === 'array' && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validate(schema.items, item, `${path}[${index}]`));
    });
  }

  return errors;
}
