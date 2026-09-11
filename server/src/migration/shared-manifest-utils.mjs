const bool = (value) => value == null ? value : Boolean(Number(value));

export function migrationTable({ name, columns, conflict, booleans = [], dependencies = [] }) {
  return Object.freeze({
    name,
    columns: Object.freeze(columns),
    conflict: Object.freeze(conflict),
    dependencies: Object.freeze(dependencies),
    transform(row) {
      const next = {};
      for (const column of columns) next[column] = row[column] ?? null;
      for (const column of booleans) if (next[column] != null) next[column] = bool(next[column]);
      return next;
    },
  });
}

export function relationshipCheck({ name, sql, description }) {
  return Object.freeze({ name, sql, description });
}
