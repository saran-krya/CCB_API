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
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CreateLovDto, GetLovDto, SetLovCategoryModuleDto, UpdateLovDto } from './dto/lov.dto';
import { LovCategory } from './entities/lov-category.entity';
import { LovValue } from './entities/lov-value.entity';
import { LovService } from './lov.service';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';

@ApiBearerAuth()
@ApiTags('LOV')
@Controller('lov')
export class LovController {
  constructor(private readonly lovService: LovService) {}

  @Get('categories')
  @Permission(ACTION_CODES.LOV_VIEW)
  @ApiOkResponse({ type: String, isArray: true })
  findCategories(): Promise<string[]> {
    return this.lovService.findCategories();
  }

  @Get('categories/modules')
  @Permission(ACTION_CODES.LOV_VIEW)
  @ApiOkResponse({ type: Object })
  findCategoryModules(): Promise<Record<string, string | null>> {
    return this.lovService.findCategoryModules();
  }

  @Patch('categories/:category/module')
  @Permission(ACTION_CODES.LOV_MODULE_ASSIGN)
  @ApiOkResponse({ type: LovCategory })
  setCategoryModule(
    @Param('category') category: string,
    @Body() dto: SetLovCategoryModuleDto,
  ): Promise<LovCategory> {
    return this.lovService.setCategoryModule(category, dto.module);
  }

  @Get('languages')
  @Authenticated()
  @ApiOkResponse({ type: LovValue, isArray: true })
  findActiveLanguages(): Promise<LovValue[]> {
    return this.lovService.findActiveLanguages();
  }

  // @Authenticated, not @Permission — LOV values are shared read-only config consumed by ordinary
  // feature pages (e.g. dropdown options in the registration wizard), not just the LOV management
  // screen. Any signed-in staff user can read them; only writes below stay permission-gated.
  @Get()
  @Authenticated()
  @ApiOkResponse({ type: LovValue, isArray: true })
  findByCategory(@Query() query: GetLovDto): Promise<LovValue[]> {
    if (!query.category) return this.lovService.findAll();
    return this.lovService.findByCategory(query.category, query.includeInactive ?? false);
  }

  @Post()
  @Permission(ACTION_CODES.LOV_CREATE)
  @ApiOkResponse({ type: LovValue })
  create(@Body() dto: CreateLovDto): Promise<LovValue> {
    return this.lovService.create(dto);
  }

  @Patch(':id')
  @Permission(ACTION_CODES.LOV_EDIT)
  @ApiOkResponse({ type: LovValue })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLovDto,
  ): Promise<LovValue> {
    return this.lovService.update(id, dto);
  }

  @Delete(':id')
  @Permission(ACTION_CODES.LOV_DELETE)
  @ApiOkResponse()
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.lovService.remove(id);
  }
}
