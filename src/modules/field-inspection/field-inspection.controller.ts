import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { FieldInspectionService } from './field-inspection.service';
import {
  CreateFieldInspectionRequestDto,
  FieldInspectionQueryDto,
  SelectableReadingsQueryDto,
} from './dto/field-inspection.dto';

// Gated on the same single permission that governs all of Billing Readiness — Request Field
// Inspection is launched from any of its tabs (Dashboard, Property Billing Readiness), all of which
// derive visibility from BILLING_READINESS_VIEW alone. This feature has no dedicated action of its
// own, matching the existing "one action, reused elsewhere" pattern already established for
// Readings List (METER_VIEW) and Bill Run's own tab.
const FIELD_INSPECTION_ACCESS = ['BILLING_READINESS_VIEW'];

@ApiBearerAuth()
@ApiTags('Field Inspection')
@Controller({ path: 'field-inspection', version: '1' })
export class FieldInspectionController {
  constructor(private readonly fieldInspection: FieldInspectionService) {}

  @Get('selectable-readings')
  @Permission(...FIELD_INSPECTION_ACCESS)
  @ApiOperation({ summary: 'Anomalous, unapproved readings for a property not already covered by an existing inspection request' })
  getSelectableReadings(@Query() query: SelectableReadingsQueryDto) {
    return this.fieldInspection.getSelectableReadings(query.propertyId);
  }

  @Get()
  @Permission(...FIELD_INSPECTION_ACCESS)
  @ApiOperation({ summary: 'Inspection requests — for one property, or every property when propertyId is omitted' })
  findAll(@Query() query: FieldInspectionQueryDto) {
    return this.fieldInspection.findAllForProperty(query.propertyId);
  }

  @Post()
  @Permission(...FIELD_INSPECTION_ACCESS)
  @ApiOperation({ summary: 'Create a field inspection request' })
  create(@Body() dto: CreateFieldInspectionRequestDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.fieldInspection.create(dto, user?.sub);
  }
}
