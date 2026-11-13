/** Modules the platform cannot work without: the landing page, the administration area, and the two Settings areas every user
 *  reaches their own account through. Deactivating one removes its menu entry for EVERY user (an inactive module is left out of
 *  the navigation catalog and the role-permission editor), and deleting one would orphan its screens — so neither is allowed. */
export const PROTECTED_MODULE_CODES: readonly string[] = ['DASHBOARD', 'SYSTEM_ADMIN', 'PERSONAL_SETTINGS', 'SECURITY_SETTINGS'];

/** True for a protected module's own code. A sub-module or screen whose CURRENT parent resolves to one of these is
 *  itself protected (SubModulesService, ScreensService): the module-level checks above stop someone from
 *  deactivating/deleting/renaming the module row directly, but do nothing to stop the same result one level down —
 *  deleting or deactivating every sub-module and screen under it has the identical effect of leaving that module
 *  empty of the functionality it exists for. */
export const isProtectedModuleCode = (code: string | null | undefined): boolean => !!code && PROTECTED_MODULE_CODES.includes(code);

export const MODULE_CATALOG_STATUS_FILTER = {
  ALL: 'all',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type ModuleCatalogStatusFilter = (typeof MODULE_CATALOG_STATUS_FILTER)[keyof typeof MODULE_CATALOG_STATUS_FILTER];
export const MODULE_CATALOG_STATUS_VALUES = Object.values(MODULE_CATALOG_STATUS_FILTER);
