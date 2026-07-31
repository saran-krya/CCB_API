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

@ApiBearerAuth()
@ApiTags('LOV')
@Controller('lov')
export class LovController {
  constructor(private readonly lovService: LovService) {}

  @Get('categories')
  @Permission('LOV_VIEW')
  @ApiOkResponse({ type: String, isArray: true })
  findCategories(): Promise<string[]> {
    return this.lovService.findCategories();
  }

  @Get('categories/modules')
  @Permission('LOV_VIEW')
  @ApiOkResponse({ type: Object })
  findCategoryModules(): Promise<Record<string, string | null>> {
    return this.lovService.findCategoryModules();
  }

  @Patch('categories/:category/module')
  @Permission('LOV_MODULE_ASSIGN')
  @ApiOkResponse({ type: LovCategory })
  setCategoryModule(
    @Param('category') category: string,
    @Body() dto: SetLovCategoryModuleDto,
  ): Promise<LovCategory> {
    return this.lovService.setCategoryModule(category, dto.module);
  }

  @Get('languages')
  @ApiOkResponse({ type: LovValue, isArray: true })
  findActiveLanguages(): Promise<LovValue[]> {
    return this.lovService.findActiveLanguages();
  }

  @Get()
  @Permission('LOV_VIEW')
  @ApiOkResponse({ type: LovValue, isArray: true })
  findByCategory(@Query() query: GetLovDto): Promise<LovValue[]> {
    if (!query.category) return this.lovService.findAll();
    return this.lovService.findByCategory(query.category, query.includeInactive ?? false);
  }

  @Post()
  @Permission('LOV_CREATE')
  @ApiOkResponse({ type: LovValue })
  create(@Body() dto: CreateLovDto): Promise<LovValue> {
    return this.lovService.create(dto);
  }

  @Patch(':id')
  @Permission('LOV_EDIT')
  @ApiOkResponse({ type: LovValue })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLovDto,
  ): Promise<LovValue> {
    return this.lovService.update(id, dto);
  }

  @Delete(':id')
  @Permission('LOV_DELETE')
  @ApiOkResponse()
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.lovService.remove(id);
  }
}
