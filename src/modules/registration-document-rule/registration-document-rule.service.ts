import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { REGISTRATION_DOCUMENT_RULES } from '../../bootstrap/seed-data';
import {
  ApplicableDocumentRuleQueryDto,
  CreateRegistrationDocumentRuleDto,
  RegistrationDocumentRuleQueryDto,
  UpdateRegistrationDocumentRuleDto,
} from './dto/registration-document-rule.dto';
import {
  RegistrationDocumentAccountType,
  RegistrationDocumentContactType,
  RegistrationDocumentLevel,
  RegistrationDocumentRequirement,
  RegistrationDocumentResident,
  RegistrationDocumentRule,
} from './entities/registration-document-rule.entity';

@Injectable()
export class RegistrationDocumentRuleService {
  private readonly logger = new Logger(RegistrationDocumentRuleService.name);

  constructor(
    @InjectRepository(RegistrationDocumentRule)
    private readonly rules: Repository<RegistrationDocumentRule>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Insert-if-missing backfill for the Registration document set (spec §8.3) — mirrors every other
   * module's ensureCriticalDefaults() (PModulesService, ScreensService, etc.). Keyed on the same
   * four columns the applicability query filters on, so re-running never duplicates a row; never
   * updates an existing row (an admin's edit via the Document Set Definition screen must never be
   * silently reverted).
   */
  async ensureCriticalDefaults(): Promise<void> {
    const existingCount = await this.rules.count();
    if (existingCount > 0) return;

    for (const r of REGISTRATION_DOCUMENT_RULES) {
      try {
        const exists = await this.rules.findOne({
          where: {
            documentType: r.documentType,
            appliesToResident: r.appliesToResident as RegistrationDocumentResident,
            appliesToAccount: r.appliesToAccount as RegistrationDocumentAccountType,
            appliesToContactType: r.appliesToContactType as RegistrationDocumentContactType,
          },
        });
        if (exists) continue;

        const entity = this.rules.create({
          documentType: r.documentType,
          level: r.level as RegistrationDocumentLevel,
          appliesToResident: r.appliesToResident as RegistrationDocumentResident,
          appliesToAccount: r.appliesToAccount as RegistrationDocumentAccountType,
          appliesToContactType: r.appliesToContactType as RegistrationDocumentContactType,
          requirement: r.requirement as RegistrationDocumentRequirement,
          isActive: true,
          displayOrder: r.displayOrder,
        });
        await this.rules.save(entity);
      } catch (err) {
        this.logger.error(`Failed to seed registration document rule "${r.documentType}" — skipping`, err as Error);
      }
    }
  }

  async create(dto: CreateRegistrationDocumentRuleDto, actorId?: number) {
    const rule = this.rules.create({
      ...dto,
      isActive: dto.isActive ?? true,
      displayOrder: dto.displayOrder ?? 1,
    });
    const saved = await this.rules.save(rule);

    await this.audit.record({
      moduleName: 'registration-document-rules',
      entityId: saved.id,
      action: 'CREATE',
      newValue: { documentType: saved.documentType, requirement: saved.requirement },
      performedBy: actorId,
    });

    return saved;
  }

  async findAll(query: RegistrationDocumentRuleQueryDto) {
    const { documentType, level, isActive } = query;

    const qb = this.rules
      .createQueryBuilder('r')
      .orderBy('r.displayOrder', 'ASC')
      .addOrderBy('r.documentType', 'ASC');

    if (documentType) qb.andWhere('r.documentType = :documentType', { documentType });
    if (level) qb.andWhere('r.level = :level', { level });
    if (isActive !== undefined) qb.andWhere('r.isActive = :isActive', { isActive });
    if (query.search) {
      qb.andWhere('r.documentType LIKE :s', { s: `%${query.search}%` });
    }

    return paginate(qb, query);
  }

  async findOne(id: number): Promise<RegistrationDocumentRule> {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Registration document rule not found');
    return rule;
  }

  async update(id: number, dto: UpdateRegistrationDocumentRuleDto, actorId?: number) {
    const rule = await this.findOne(id);
    const oldValue = { requirement: rule.requirement, isActive: rule.isActive };

    Object.assign(rule, dto);
    const saved = await this.rules.save(rule);

    await this.audit.record({
      moduleName: 'registration-document-rules',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: { requirement: saved.requirement, isActive: saved.isActive },
      performedBy: actorId,
    });

    return saved;
  }

  async remove(id: number, actorId?: number) {
    const rule = await this.findOne(id);
    await this.rules.softRemove(rule);

    await this.audit.record({
      moduleName: 'registration-document-rules',
      entityId: id,
      action: 'DELETE',
      oldValue: { documentType: rule.documentType },
      performedBy: actorId,
    });

    return { deleted: true };
  }

  /**
   * The rules in force for one applicant profile — every ACTIVE rule whose applicability columns
   * match (resident === value OR 'Both'; account === value OR 'Both'; contactType === value OR
   * 'Any'), excluding NOT_APPLICABLE. Mirrors the registration wizard's `applicableDocRules`.
   */
  async getApplicableRules(query: ApplicableDocumentRuleQueryDto): Promise<RegistrationDocumentRule[]> {
    const { residentType, accountType, contactType } = query;

    const qb = this.rules
      .createQueryBuilder('r')
      .where('r.isActive = :active', { active: true })
      .andWhere('r.requirement != :na', { na: RegistrationDocumentRequirement.NOT_APPLICABLE })
      .andWhere('(r.appliesToResident = :resident OR r.appliesToResident = :bothResident)', {
        resident: residentType,
        bothResident: RegistrationDocumentResident.BOTH,
      })
      .andWhere('(r.appliesToAccount = :account OR r.appliesToAccount = :bothAccount)', {
        account: accountType,
        bothAccount: RegistrationDocumentAccountType.BOTH,
      })
      .orderBy('r.displayOrder', 'ASC');

    if (contactType) {
      qb.andWhere('(r.appliesToContactType = :contactType OR r.appliesToContactType = :anyContact)', {
        contactType,
        anyContact: RegistrationDocumentContactType.ANY,
      });
    } else {
      qb.andWhere('r.appliesToContactType = :anyContact', {
        anyContact: RegistrationDocumentContactType.ANY,
      });
    }

    return qb.getMany();
  }
}
