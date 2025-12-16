export function recordFromMap(map: Map<string, string>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of map.entries()) {
    record[key] = value;
  }
  return record;
}

export function mapFromRecord(record: Record<string, string> | undefined): Map<string, string> | undefined {
  if (!record) {
    return undefined;
  }
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(record)) {
    map.set(key, value);
  }
  return map;
}
