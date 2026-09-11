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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CustomerService } from './customer.service';
import { ActivateCustomerDto } from './dto/activate-customer.dto';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/create-customer.dto';
import { CustomerDetailDto, CustomerListDto } from './dto/customer-response.dto';
import { OpenForTenantQueryDto, UnitResidentConflictQueryDto } from './dto/open-for-tenant.dto';

@ApiBearerAuth()
@ApiTags('Customers')
@Controller({ path: 'customers', version: '1' })
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Post()
  @Permission('CREATE_CUSTOMER')
  @ApiOperation({ summary: 'Register a customer against a unit' })
  create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.customers.create(dto, user?.sub);
  }

  @Get()
  @Permission('VIEW_CUSTOMER')
  @ApiOperation({ summary: 'List all customers with pagination and filters' })
  @ApiOkResponse({ type: CustomerListDto, isArray: true, description: 'Paginated list of customers' })
  findAll(@Query() query: CustomerQueryDto) {
    return this.customers.findAll(query);
  }

  @Get('units/open-for-tenant')
  @Permission('VIEW_CUSTOMER', 'VIEW_REGISTRATION_REQUESTS', 'CREATE_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Resolve tenant-occupancy eligibility for one or more units' })
  checkUnitsOpenForTenant(@Query() query: OpenForTenantQueryDto) {
    return this.customers.checkUnitsOpenForTenant(query.unitIds);
  }

  @Get('units/resident-conflicts')
  @Permission('VIEW_CUSTOMER', 'VIEW_REGISTRATION_REQUESTS', 'CREATE_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Check whether a customer of the given resident type already exists on one or more units' })
  checkUnitResidentTypeConflicts(@Query() query: UnitResidentConflictQueryDto) {
    return this.customers.checkUnitResidentTypeConflicts(query.unitIds, query.residentType);
  }

  // No @Permission() — the customer holds no staff role/JWT at this point, only their emailed
  // one-time activation token (validated inside CustomerService.activate itself, not by any guard).
  @Public()
  @Post('activate')
  @ApiOperation({ summary: 'Consume a one-time activation link and set the customer\'s own password' })
  activate(@Body() dto: ActivateCustomerDto) {
    return this.customers.activate(dto);
  }

  @Post(':id/resend-activation')
  @Permission('EDIT_CUSTOMER')
  @ApiOperation({ summary: 'Re-send the activation email with a fresh token (invalidates any previous unused token)' })
  @ApiParam({ name: 'id', type: Number })
  resendActivation(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.customers.resendActivationEmail(id, user?.sub);
  }

  @Get(':id')
  @Permission('VIEW_CUSTOMER')
  @ApiOperation({ summary: 'Get customer detail' })
  @ApiOkResponse({ type: CustomerDetailDto })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customers.findOne(id);
  }

  @Patch(':id')
  @Permission('EDIT_CUSTOMER')
  @ApiOperation({ summary: 'Update customer' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.customers.update(id, dto, user?.sub);
  }

  @Delete(':id')
  @Permission('DELETE_CUSTOMER')
  @ApiOperation({ summary: 'Soft-delete a customer' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.customers.remove(id, user?.sub);
  }
}
