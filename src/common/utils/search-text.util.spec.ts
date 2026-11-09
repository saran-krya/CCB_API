import { applyMultiWordSearch, escapeLikeTerm, likeContainsPattern, splitSearchWords } from './search-text.util';

// Isolated tests for the multi-word search fix — the real, confirmed gap this closes: every provider
// used to require the ENTIRE search phrase as one rigid, contiguous LIKE pattern ('%Azizi Pearl%'),
// so a two-word search failed against a record whose text had the words in a different order or with
// something else between them (e.g. "The Pearl by Azizi"). A fake query builder stands in for TypeORM's
// real one — only `andWhere`'s call arguments are under test here, not a real database.
describe('applyMultiWordSearch', () => {
  interface FakeQb {
    andWhere: jest.Mock;
  }

  function fakeQueryBuilder(): { qb: FakeQb; calls: Array<{ where: string; params: Record<string, unknown> }> } {
    const calls: Array<{ where: string; params: Record<string, unknown> }> = [];
    const qb: FakeQb = {
      andWhere: jest.fn((where: string, params: Record<string, unknown> = {}) => {
        calls.push({ where, params });
        return qb;
      }),
    };
    return { qb, calls };
  }

  it('a single-word term adds exactly one andWhere, OR-ed across every given column', () => {
    const { qb, calls } = fakeQueryBuilder();

    applyMultiWordSearch(qb, ['c.name', 'c.code'], 'Pearl');

    expect(calls).toHaveLength(1);
    expect(calls[0].where).toBe('(c.name LIKE :w0 OR c.code LIKE :w0)');
    expect(calls[0].params).toEqual({ w0: '%Pearl%' });
  });

  it('a two-word term adds one AND-ed andWhere PER WORD, not one clause requiring the exact phrase', () => {
    const { qb, calls } = fakeQueryBuilder();

    applyMultiWordSearch(qb, ['c.name'], 'Azizi Pearl');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ where: '(c.name LIKE :w0)', params: { w0: '%Azizi%' } });
    expect(calls[1]).toEqual({ where: '(c.name LIKE :w1)', params: { w1: '%Pearl%' } });
    // Two independent andWhere calls is exactly what proves "Azizi" and "Pearl" can each match ANYWHERE
    // in the column, in any order — never one clause demanding the literal contiguous phrase.
  });

  it('collapses repeated whitespace between words instead of treating it as an empty word', () => {
    const { qb, calls } = fakeQueryBuilder();

    applyMultiWordSearch(qb, ['c.name'], '  Azizi   Pearl  ');

    expect(calls).toHaveLength(2);
    expect(calls[0].params).toEqual({ w0: '%Azizi%' });
    expect(calls[1].params).toEqual({ w1: '%Pearl%' });
  });

  it('escapes LIKE wildcard characters in each word independently', () => {
    const { qb, calls } = fakeQueryBuilder();

    applyMultiWordSearch(qb, ['u.email'], 'saran.kumar 50%_off');

    expect(calls[0].params).toEqual({ w0: '%saran.kumar%' });
    expect(calls[1].params).toEqual({ w1: '%50\\%\\_off%' });
  });

  it('uses the given paramPrefix so two calls on the same query never collide', () => {
    const { qb, calls } = fakeQueryBuilder();

    applyMultiWordSearch(qb, ['a.x'], 'one two', 'extra');

    expect(calls[0].where).toContain(':extra0');
    expect(calls[1].where).toContain(':extra1');
  });

  it('returns the same builder instance for chaining', () => {
    const { qb } = fakeQueryBuilder();

    expect(applyMultiWordSearch(qb, ['a.x'], 'term')).toBe(qb);
  });
});

describe('splitSearchWords', () => {
  it('splits on whitespace and drops empty segments', () => {
    expect(splitSearchWords('  Azizi   Pearl  ')).toEqual(['Azizi', 'Pearl']);
  });

  it('returns [] for an empty or whitespace-only string', () => {
    expect(splitSearchWords('')).toEqual([]);
    expect(splitSearchWords('   ')).toEqual([]);
  });
});

describe('likeContainsPattern / escapeLikeTerm (pre-existing, re-confirmed alongside the new behavior)', () => {
  it('wraps the escaped term in %...%', () => {
    expect(likeContainsPattern('Pearl')).toBe('%Pearl%');
  });

  it('escapes %, _ and backslash', () => {
    expect(escapeLikeTerm('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
