import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/decorators/permission.decorator';
import { CreateLovDto, GetLovDto, SetLovCategoryModuleDto, UpdateLovDto } from './dto/lov.dto';
import { LovCategory } from './entities/lov-category.entity';
import { LovValue } from './entities/lov-value.entity';
import { LovService } from './lov.service';

// Route-level @Permission() — previously this controller had NO
// authorization at all (any authenticated user of any role could create,
// edit, delete LOV values or reassign a category's module). Gated by
// Screen Action (LOV_MASTER_SCREEN screen) instead of hardcoded roles, so
// access is controlled entirely through Role Permissions per role.
@ApiBearerAuth()
@ApiTags('LOV')
@Controller('lov')
export class LovController {
  constructor(private readonly lovService: LovService) {}

  /** GET /lov/categories — list all distinct categories */
  @Get('categories')
  @Permission('LOV_VIEW')
  @ApiOkResponse({ type: String, isArray: true })
  findCategories(): Promise<string[]> {
    return this.lovService.findCategories();
  }

  /** GET /lov/categories/modules — map of category -> assigned module (null = General) */
  @Get('categories/modules')
  @Permission('LOV_VIEW')
  @ApiOkResponse({ type: Object })
  findCategoryModules(): Promise<Record<string, string | null>> {
    return this.lovService.findCategoryModules();
  }

  /** PATCH /lov/categories/:category/module — assign or reassign a category's module */
  @Patch('categories/:category/module')
  @Permission('LOV_MODULE_ASSIGN')
  @ApiOkResponse({ type: LovCategory })
  setCategoryModule(
    @Param('category') category: string,
    @Body() dto: SetLovCategoryModuleDto,
  ): Promise<LovCategory> {
    return this.lovService.setCategoryModule(category, dto.module);
  }

  /** GET /lov/languages — active Language values, every authenticated user */
  // Deliberately NOT @Permission()-gated (unlike every other route on this
  // controller) — every authenticated user, regardless of role, needs the
  // list of active languages to use the Settings page's language switcher,
  // not just users granted LOV_VIEW for admin LFM management. Mirrors
  // AuthController.getSessionConfig()'s justification exactly. Must be
  // declared before the bare @Get() catch-all below so "languages" isn't
  // swallowed by it.
  @Get('languages')
  @ApiOkResponse({ type: LovValue, isArray: true })
  findActiveLanguages(): Promise<LovValue[]> {
    return this.lovService.findActiveLanguages();
  }

  /** GET /lov?category=BILLING_FREQUENCY — values for a category */
  @Get()
  @Permission('LOV_VIEW')
  @ApiOkResponse({ type: LovValue, isArray: true })
  findByCategory(@Query() query: GetLovDto): Promise<LovValue[]> {
    if (!query.category) return this.lovService.findAll();
    return this.lovService.findByCategory(query.category, query.includeInactive ?? false);
  }

  /** POST /lov — create a new LOV value */
  @Post()
  @Permission('LOV_CREATE')
  @ApiOkResponse({ type: LovValue })
  create(@Body() dto: CreateLovDto): Promise<LovValue> {
    return this.lovService.create(dto);
  }

  /** PATCH /lov/:id — update a LOV value */
  @Patch(':id')
  @Permission('LOV_EDIT')
  @ApiOkResponse({ type: LovValue })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLovDto,
  ): Promise<LovValue> {
    return this.lovService.update(id, dto);
  }

  /** DELETE /lov/:id — soft-delete a LOV value */
  @Delete(':id')
  @Permission('LOV_DELETE')
  @ApiOkResponse()
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.lovService.remove(id);
  }
}
