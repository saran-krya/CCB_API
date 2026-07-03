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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ROLES } from '../../common/constants/global';
import { BillingCycleService } from './billing-cycle.service';
import {
  BillingCycleQueryDto,
  CreateBillingCycleDto,
  UpdateBillingCycleDto,
} from './dto/billing-cycle.dto';

@ApiBearerAuth()
@ApiTags('Billing Cycles')
@Roles(ROLES.ADMIN, ROLES.OPERATIONS)
@Controller({ path: 'billing-cycles', version: '1' })
export class BillingCycleController {
  constructor(private readonly billingCycles: BillingCycleService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get billing cycle dashboard stats' })
  getStats() {
    return this.billingCycles.getStats();
  }

  @Get('metaFilters')
  @ApiOperation({ summary: 'Get filter metadata for the billing cycle list UI' })
  getFilterMetadata() {
    return this.billingCycles.getFilterMetadata();
  }

  @Get()
  @ApiOperation({ summary: 'List billing cycles with pagination and filters' })
  findAll(@Query() query: BillingCycleQueryDto) {
    return this.billingCycles.findAll(query);
  }

  @Get('property/:propertyId')
  @ApiOperation({ summary: 'Get billing cycle for a specific property' })
  @ApiParam({ name: 'propertyId', type: Number })
  findByProperty(@Param('propertyId', ParseIntPipe) propertyId: number) {
    return this.billingCycles.findByProperty(propertyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get billing cycle by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.billingCycles.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a billing cycle for a property' })
  create(
    @Body() dto: CreateBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.create(dto, user?.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a billing cycle' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.update(id, dto, user?.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a billing cycle' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.remove(id, user?.sub);
  }
}
