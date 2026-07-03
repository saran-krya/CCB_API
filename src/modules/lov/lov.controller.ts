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
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreateLovDto, GetLovDto, UpdateLovDto } from './dto/lov.dto';
import { LovValue } from './entities/lov-value.entity';
import { LovService } from './lov.service';

@ApiTags('LOV')
@Controller('lov')
export class LovController {
  constructor(private readonly lovService: LovService) {}

  /** GET /lov/categories — list all distinct categories */
  @Get('categories')
  @ApiOkResponse({ type: String, isArray: true })
  findCategories(): Promise<string[]> {
    return this.lovService.findCategories();
  }

  /** GET /lov?category=BILLING_FREQUENCY — values for a category */
  @Get()
  @ApiOkResponse({ type: LovValue, isArray: true })
  findByCategory(@Query() query: GetLovDto): Promise<LovValue[]> {
    if (!query.category) return this.lovService.findAll();
    return this.lovService.findByCategory(query.category);
  }

  /** POST /lov — create a new LOV value */
  @Post()
  @ApiOkResponse({ type: LovValue })
  create(@Body() dto: CreateLovDto): Promise<LovValue> {
    return this.lovService.create(dto);
  }

  /** PATCH /lov/:id — update a LOV value */
  @Patch(':id')
  @ApiOkResponse({ type: LovValue })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLovDto,
  ): Promise<LovValue> {
    return this.lovService.update(id, dto);
  }

  /** DELETE /lov/:id — soft-delete a LOV value */
  @Delete(':id')
  @ApiOkResponse()
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.lovService.remove(id);
  }
}
