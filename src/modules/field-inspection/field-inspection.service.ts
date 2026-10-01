import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FieldInspectionRequest } from './entities/field-inspection-request.entity';
import { MeterReading, ReadingApprovalStatus, ReadingValidationStatus } from '../sftp/entities/meter-reading.entity';
import { Property } from '../property/entities/property.entity';
import { User } from '../user/entities/user.entity';
import { LovService } from '../lov/lov.service';
import { CreateFieldInspectionRequestDto } from './dto/field-inspection.dto';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import { UserRoleService } from '../user-role/user-role.service';

const LOV_TYPE_CATEGORY = 'FIELD_INSPECTION_TYPE';
const LOV_PRIORITY_CATEGORY = 'FIELD_INSPECTION_PRIORITY';
const LOV_NOTIFY_CATEGORY = 'FIELD_INSPECTION_NOTIFY_ROLE';

@Injectable()
export class FieldInspectionService {
  constructor(
    @InjectRepository(FieldInspectionRequest) private readonly requests: Repository<FieldInspectionRequest>,
    @InjectRepository(MeterReading) private readonly meterReadings: Repository<MeterReading>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly lov: LovService,
    private readonly userRoles: UserRoleService,
  ) {}

  // Every currently-anomalous, not-yet-approved reading for this property that isn't ALREADY
  // covered by an existing (any-status) inspection request — the real equivalent of the Template's
  // mock "submittedUnitIds are locked" rule. Mirrors BillingReadinessService's own anomaly criteria
  // (validationStatus=ANOMALY, approvalStatus=PENDING) rather than inventing a second definition of
  // "anomalous" — see billing-readiness.service.ts's getUnresolvedAnomalyCounts for the sibling
  // query this is deliberately consistent with.
  async getSelectableReadings(propertyId: number) {
    const alreadyRequested = await this.requests
      .createQueryBuilder('r')
      .innerJoin('r.readings', 'reading')
      .where('r.propertyId = :propertyId', { propertyId })
      .select('reading.id', 'id')
      .getRawMany<{ id: number }>();
    const excludeIds = alreadyRequested.map((r) => r.id);

    const qb = this.meterReadings
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.propertyUnit', 'unit')
      .where('r.property_id = :propertyId', { propertyId })
      .andWhere('r.validation_status = :status', { status: ReadingValidationStatus.ANOMALY })
      .andWhere('r.approval_status = :approval', { approval: ReadingApprovalStatus.PENDING })
      .orderBy('r.reading_date', 'DESC');

    if (excludeIds.length > 0) {
      qb.andWhere('r.id NOT IN (:...excludeIds)', { excludeIds });
    }

    const readings = await qb.getMany();

    return readings.map((r) => ({
      meterReadingId: r.id,
      meterId: r.meterId,
      unit: r.propertyUnit?.unitNumber ?? null,
      floor: r.propertyUnit?.floorNumber ?? null,
      severity: r.anomalySeverity,
      anomalyCode: r.anomalyCode,
      anomalyMessage: r.anomalyMessage,
      deviationPercent: null as number | null, // computed elsewhere (MeterService) — not duplicated here; see this module's own README-style comment in the controller if a deviation figure is needed later
      approvalStatus: r.approvalStatus,
      detectedDate: r.readingDate,
    }));
  }

  // propertyId omitted = every request across the estate — mirrors BillingReadinessService.getReadiness's
  // own optional-filter convention, used by the dashboard's bulk "does this property have any prior
  // requests" indicator (one request, not one per row).
  async findAllForProperty(propertyId?: number) {
    const requests = await this.requests.find({
      where: propertyId ? { propertyId } : {},
      relations: { property: true, assignedTo: true, requestedBy: true, readings: true },
      order: { requestedOn: 'DESC' },
    });
    return requests.map((r) => this.toResponseShape(r));
  }

  async create(dto: CreateFieldInspectionRequestDto, requestedById?: number) {
    const property = await this.properties.findOne({ where: { id: dto.propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    const [typeOptions, priorityOptions, notifyOptions] = await Promise.all([
      this.lov.findByCategory(LOV_TYPE_CATEGORY),
      this.lov.findByCategory(LOV_PRIORITY_CATEGORY),
      this.lov.findByCategory(LOV_NOTIFY_CATEGORY),
    ]);
    if (!typeOptions.some((o) => o.code === dto.inspectionType)) {
      throw new BadRequestException(`"${dto.inspectionType}" is not a valid inspection type`);
    }
    if (!priorityOptions.some((o) => o.code === dto.priority)) {
      throw new BadRequestException(`"${dto.priority}" is not a valid priority`);
    }
    const notify = dto.notify ?? [];
    const invalidNotify = notify.filter((n) => !notifyOptions.some((o) => o.code === n));
    if (invalidNotify.length > 0) {
      throw new BadRequestException(`Invalid notify option(s): ${invalidNotify.join(', ')}`);
    }

    const assignee = await this.users.findOne({ where: { id: dto.assignedToUserId } });
    if (!assignee) throw new NotFoundException('Assigned user not found');
    if (!(await this.userRoles.hasRoleCapability(assignee.id, 'canBeFieldInspector'))) {
      throw new BadRequestException('The selected user cannot be assigned field inspections');
    }

    const readingsWithProperty = await this.meterReadings.find({
      where: { id: In(dto.meterReadingIds) },
      relations: { property: true },
    });
    if (readingsWithProperty.length !== dto.meterReadingIds.length) {
      throw new BadRequestException('One or more selected readings were not found');
    }
    const wrongProperty = readingsWithProperty.filter((r) => r.property?.id !== dto.propertyId);
    if (wrongProperty.length > 0) {
      throw new BadRequestException('One or more selected readings do not belong to this property');
    }

    const entity = this.requests.create({
      propertyId: dto.propertyId,
      inspectionType: dto.inspectionType,
      priority: dto.priority,
      description: dto.description,
      inspectionDate: dto.inspectionDate,
      assignedToUserId: dto.assignedToUserId,
      notify,
      resolutionBy: dto.resolutionBy,
      notes: dto.notes ?? null,
      requestedById: requestedById ?? null,
      requestedOn: new Date(),
      readings: readingsWithProperty,
    });
    let saved = await this.requests.save(entity);
    saved.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.FIELD_INSPECTION, saved.id);
    saved = await this.requests.save(saved);

    const full = await this.requests.findOne({
      where: { id: saved.id },
      relations: { property: true, assignedTo: true, requestedBy: true, readings: true },
    });
    return this.toResponseShape(full!);
  }

  private toResponseShape(r: FieldInspectionRequest) {
    return {
      id: r.id,
      businessCode: r.businessCode ?? null,
      propertyId: r.propertyId,
      inspectionType: r.inspectionType,
      priority: r.priority,
      description: r.description,
      inspectionDate: r.inspectionDate,
      assignedTo: r.assignedTo
        ? { id: r.assignedTo.id, firstName: r.assignedTo.firstName, lastName: r.assignedTo.lastName }
        : null,
      notify: r.notify,
      resolutionBy: r.resolutionBy,
      notes: r.notes ?? null,
      status: r.status,
      requestedBy: r.requestedBy
        ? { id: r.requestedBy.id, firstName: r.requestedBy.firstName, lastName: r.requestedBy.lastName }
        : null,
      requestedOn: r.requestedOn,
      selectedMeterReadingIds: (r.readings ?? []).map((x) => x.id),
    };
  }
}
