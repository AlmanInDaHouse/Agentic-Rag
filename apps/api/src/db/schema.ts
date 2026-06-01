const schemaNamePattern = /^[a-zA-Z0-9_]+$/;

export function validateDbSchemaName(schemaName: string): string {
  if (!schemaNamePattern.test(schemaName)) {
    throw new Error(
      `Invalid PostgreSQL schema name "${schemaName}". Only letters, numbers and underscores are allowed.`
    );
  }

  return schemaName;
}

export function quoteIdentifier(identifier: string): string {
  const validIdentifier = validateDbSchemaName(identifier);
  return `"${validIdentifier.replaceAll('"', '""')}"`;
}

export function searchPathSql(schemaName: string): string {
  return `${quoteIdentifier(schemaName)},public`;
}

export function searchPathOption(schemaName: string): string {
  return `${validateDbSchemaName(schemaName)},public`;
}
