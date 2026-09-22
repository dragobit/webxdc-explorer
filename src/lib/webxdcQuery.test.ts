import { describe, expect, it } from 'vitest';

import { compareStat, parseStatsQuery } from '@/lib/webxdcQuery';

describe('parseStatsQuery', () => {
  it('parses operators', () => {
    expect(parseStatsQuery('updates>5')).toEqual({ field: 'updates', op: '>', value: 5 });
    expect(parseStatsQuery('participants>=2')).toEqual({ field: 'participants', op: '>=', value: 2 });
    expect(parseStatsQuery('updates<=3')).toEqual({ field: 'updates', op: '<=', value: 3 });
    expect(parseStatsQuery('updates=0')).toEqual({ field: 'updates', op: '=', value: 0 });
    expect(parseStatsQuery('Updates<10')).toEqual({ field: 'updates', op: '<', value: 10 });
  });

  it('returns undefined for plain text', () => {
    expect(parseStatsQuery('chess')).toBeUndefined();
    expect(parseStatsQuery('updates>')).toBeUndefined();
    expect(parseStatsQuery('updates>abc')).toBeUndefined();
    expect(parseStatsQuery('my updates>5')).toBeUndefined();
    expect(parseStatsQuery('')).toBeUndefined();
  });
});

describe('compareStat', () => {
  it('compares', () => {
    expect(compareStat(6, '>', 5)).toBe(true);
    expect(compareStat(5, '>', 5)).toBe(false);
    expect(compareStat(2, '>=', 2)).toBe(true);
    expect(compareStat(0, '=', 0)).toBe(true);
  });
});
