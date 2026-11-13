import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MODULE_CATALOG_STATUS_VALUES, ModuleCatalogStatusFilter } from '../pmodules.constants';

/** Filters of GET /pmodules/catalog. */
export class ModuleCatalogQueryDto {
  @ApiPropertyOptional({ description: 'Keeps the modules whose own name or code, or that of any sub-module or screen under them, contains this text' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: MODULE_CATALOG_STATUS_VALUES, default: 'all', description: 'Filters on the MODULE\'s own availability' })
  @IsOptional()
  @IsIn(MODULE_CATALOG_STATUS_VALUES)
  status?: ModuleCatalogStatusFilter;
}

export interface CatalogScreen {
  id: number;
  name: string;
  code: string;
  url: string | null;
  displayOrder: number;
  isActive: boolean;
  /** Active permission actions defined on this screen. */
  actionCount: number;
}

export interface CatalogSubModule {
  id: number;
  name: string;
  code: string;
  url: string | null;
  displayOrder: number;
  isActive: boolean;
  screens: CatalogScreen[];
}

export interface CatalogModule {
  id: number;
  moduleName: string;
  code: string;
  type: string;
  icon: string | null;
  url: string | null;
  displayOrder: number;
  isActive: boolean;
  /** A module the platform needs (see PROTECTED_MODULE_CODES): it cannot be deactivated or deleted. */
  isProtected: boolean;
  subModules: CatalogSubModule[];
  /** Screens that sit directly under the module (a PAGE-type module has no sub-modules). */
  screens: CatalogScreen[];
}

export interface ModuleCatalogTotals {
  modules: number;
  activeModules: number;
  subModules: number;
  screens: number;
  actions: number;
}

export interface ModuleCatalogResponse {
  /** Counted over the WHOLE catalog, whatever the filters keep. */
  totals: ModuleCatalogTotals;
  modules: CatalogModule[];
}
