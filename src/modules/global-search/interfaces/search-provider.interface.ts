/** One match, already shaped for the frontend — never the raw entity. Every provider maps its own
 *  columns onto exactly these fields, so GlobalSearchService and the HTTP layer never need to know
 *  anything entity-specific. */
export interface GlobalSearchResultItem {
  /** Stable machine key for the kind of record this is (e.g. "USER", "UNIT") — not shown to the user,
   *  used by the frontend only to pick an icon/behaviour if it ever needs to. */
  entityType: string;
  /** The record's own primary key, as a string — callers needing the real typed id can parse it back;
   *  kept as a string here since some providers key on a UUID/business id rather than a numeric PK. */
  id: string;
  /** The human display name for the group this result belongs to (e.g. "User Management") — exactly
   *  what a module calls itself elsewhere in the app, not a code. */
  module: string;
  /** The record's own display title — the field a user would recognize it by (a person's name, a
   *  business/unit code, an invoice number, ...). */
  title: string;
  /** A short secondary line of context (email, parent community/property, role name, ...). Omitted
   *  when a provider has nothing useful to add beyond the title. */
  description?: string;
  /** The record's current status/state label, already resolved to display text (never a raw enum
   *  value) — omitted for entities with no such concept. */
  status?: string;
  /** Relative frontend path to the record's own page — already fully resolved (including any parent
   *  ids a nested route needs), so the frontend never has to know how any entity's URL is built. */
  url: string;
}

/** What a provider needs to decide, for THIS request's caller, whether it should run at all —
 *  resolved once per request by GlobalSearchService (one DB round trip for the granted-action-code
 *  set), never recomputed per provider. Deliberately not just "one action code": Policy Management is
 *  gated by a role check, not an action code (see PolicySearchProvider), so a single
 *  `requiredActionCode` field could not have expressed every real rule this app already enforces
 *  elsewhere — providers decide for themselves from these two primitives instead, the same two
 *  primitives PermissionGuard/RolesGuard themselves are built from. */
export interface SearchAuthContext {
  grantedActionCodes: Set<string>;
  isSuperAdmin: boolean;
}

/** The plug-in contract a module's own search provider implements. Adding a newly-searchable entity
 *  means writing one class that implements this and registering it in global-search.module.ts's own
 *  provider list — GlobalSearchService, GlobalSearchController and every existing provider stay
 *  completely unchanged. */
export interface GlobalSearchProvider {
  /** Must be unique across every registered provider — used only for logging/debugging, never shown
   *  to the user and never relied on by the frontend (that's `entityType` on each result instead). */
  readonly providerName: string;

  /** Whether this provider should even be asked to search, for this request's caller. Reuses exactly
   *  the same authorization primitives (granted action codes / SUPER_ADMIN) already enforced on this
   *  entity's own real list/detail endpoint — never a new or looser rule invented for search. */
  isEnabledFor(context: SearchAuthContext): boolean;

  /** Return at most `limit` matches for `term` (already validated: trimmed, non-empty, within the
   *  length cap — see normalizeSearchTerm). Must apply its own LIMIT in the query itself, never load a
   *  larger set and slice in memory. Rejects/throws only for a genuine failure; finding nothing is a
   *  normal empty array, not an error. */
  search(term: string, limit: number): Promise<GlobalSearchResultItem[]>;
}
