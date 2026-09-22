export interface StatsQuery {
  field: 'updates' | 'participants';
  op: '<' | '<=' | '>' | '>=' | '=';
  value: number;
}

/**
 * Parse numeric stat filters like `updates>5` or `participants>=2`.
 * Returns undefined for ordinary text queries.
 */
export function parseStatsQuery(q: string): StatsQuery | undefined {
  const m = q.trim().match(/^(updates|participants)(<=|>=|<|>|=)(\d+)$/i);
  if (!m) return undefined;
  return {
    field: m[1].toLowerCase() as StatsQuery['field'],
    op: m[2] as StatsQuery['op'],
    value: parseInt(m[3], 10),
  };
}

export function compareStat(actual: number, op: StatsQuery['op'], value: number): boolean {
  switch (op) {
    case '<': return actual < value;
    case '<=': return actual <= value;
    case '>': return actual > value;
    case '>=': return actual >= value;
    case '=': return actual === value;
  }
}
