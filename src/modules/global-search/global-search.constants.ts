/** DI token the array of registered GlobalSearchProvider instances is bound to (see
 *  global-search.module.ts's `useFactory`) — GlobalSearchService depends on this token, never on any
 *  individual provider class, so the service never changes when a module adds or removes a provider. */
export const GLOBAL_SEARCH_PROVIDERS = Symbol('GLOBAL_SEARCH_PROVIDERS');
