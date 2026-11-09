/** The longest search term any caller may submit — long before this, a LIKE scan across many tables
 *  stops being a meaningful query and just wastes DB time. Also protects against a pathological client
 *  sending megabytes of text as `q`. */
export const MAX_SEARCH_TERM_LENGTH = 100;

/** Validated, trimmed search term ready to embed in a LIKE pattern, or null when the input has nothing
 *  searchable in it (empty, whitespace-only, or over the length cap). Centralizing this means every
 *  search provider validates identically instead of each reimplementing the same checks slightly
 *  differently. */
export function normalizeSearchTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SEARCH_TERM_LENGTH) return null;
  return trimmed;
}

/** Escapes the three characters that are significant inside a SQL LIKE pattern (`%`, `_`, and the
 *  backslash escape character itself — MySQL's default LIKE escape character, no explicit ESCAPE
 *  clause needed) so a user's literal search text can never be (mis)read as LIKE wildcards: typing a
 *  literal "%" or "_" searches for that literal character, not "match anything" / "match any one
 *  character". TypeORM's parameter binding already prevents SQL injection on its own (the term is
 *  always a bound parameter, never concatenated into the query string) — this is purely about LIKE
 *  wildcard semantics, a separate, narrower concern from injection. */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The ready-to-bind `%term%` pattern for a `LIKE :s` clause — every provider builds its pattern this
 *  one way so the escaping above is never accidentally skipped at a call site. */
export function likeContainsPattern(term: string): string {
  return `%${escapeLikeTerm(term)}%`;
}

/** `term` split into its individual words — empty/whitespace-only input yields []. Shared so every
 *  provider's multi-word matching splits identically. */
export function splitSearchWords(term: string): string[] {
  return term.split(/\s+/).map((word) => word.trim()).filter(Boolean);
}

/** Minimal shape every TypeORM SelectQueryBuilder satisfies — avoids this file depending on 'typeorm'
 *  just for a type annotation on a function every provider (which already imports typeorm itself) calls
 *  with its own real query builder. */
interface AndWhereable {
  andWhere(where: string, parameters?: Record<string, unknown>): this;
}

/**
 * Requires EVERY word of `term` to appear, independently, in at least one of `columns` — so a two-word
 * search like "Azizi Pearl" matches a record named "The Pearl by Azizi" or "Azizi Gardens Pearl Tower"
 * just as well as one literally containing that exact two-word phrase, instead of only ever matching the
 * words contiguous and in that order. A single-word term behaves exactly like the plain `LIKE :p`
 * pattern every provider used before this existed — this is a strict generalization, not a behavior
 * change for the common case.
 *
 * Each word gets its own uniquely-named bound parameter (`${paramPrefix}0`, `${paramPrefix}1`, ...) so
 * two calls building the same query never collide, and every value is still bound, never concatenated
 * into the SQL string — the same injection-safety `likeContainsPattern` callers already relied on.
 *
 * Mutates and returns `qb` for chaining, same calling convention as TypeORM's own `.andWhere`.
 */
export function applyMultiWordSearch<T extends AndWhereable>(qb: T, columns: readonly string[], term: string, paramPrefix = 'w'): T {
  const words = splitSearchWords(term);
  words.forEach((word, index) => {
    const paramName = `${paramPrefix}${index}`;
    const orClause = columns.map((column) => `${column} LIKE :${paramName}`).join(' OR ');
    qb.andWhere(`(${orClause})`, { [paramName]: likeContainsPattern(word) });
  });
  return qb;
}
