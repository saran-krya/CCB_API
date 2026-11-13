import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ERROR_MESSAGES } from '../common/constants/error-messages.constants';
import { SORT_ORDER } from '../common/constants/sort.constants';
import { applyMultiWordSearch, normalizeSearchTerm } from '../common/utils/search-text.util';
import { User } from '../modules/user/entities/user.entity';
import { humanizeAuditToken, parseAuditValue } from './audit-log.util';
import {
  AuditLogActor,
  AuditLogDetail,
  AuditLogFilterOption,
  AuditLogListItem,
  AuditLogListResponse,
} from './dto/audit-log-response.dto';
import { AuditLogQueryDto, AuditLogSortColumn } from './dto/audit-log-query.dto';
import { AuditLog } from './entities/audit-log.entity';

/** How long the module/action filter options are reused: they only change when a new kind of event is first written. */
export const AUDIT_FILTER_OPTIONS_TTL_MS = 60_000;

/** Entries a "recent activity" widget may ask for in one call. */
export const MAX_RECENT_AUDIT_ENTRIES = 50;

const SORT_EXPRESSIONS: Record<AuditLogSortColumn, string> = {
  createdAt: 'audit.createdAt',
  moduleName: 'audit.moduleName',
  action: 'audit.action',
};

const SEARCH_COLUMNS = ['audit.action', 'audit.moduleName', 'actor.firstName', 'actor.lastName', 'actor.email'] as const;

interface RawAuditRow {
  id: number | string;
  createdAt: Date | string;
  moduleName: string;
  action: string;
  entityId: number | string | null;
  performedBy: number | string | null;
  actorFirstName: string | null;
  actorLastName: string | null;
  actorEmail: string | null;
  hasDetails: number | string | boolean;
  oldValue?: string | null;
  newValue?: string | null;
}

/** `YYYY-MM-DD` as local midnight of that day, or null when it is not a real calendar date ("2026-02-31"). */
function parseDay(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * Read side of the audit trail (`audit_logs`, written by AuditService.record from every module). A SUPER_ADMIN-only view: one
 * query joins the acting user, every filter is a bound parameter, results are paginated and newest-first by default. It only
 * ever reads — nothing here can change or delete an audit row.
 */
@Injectable()
export class AuditLogQueryService {
  private filterOptionsCache: { at: number; value: AuditLogListResponse['meta'] } | null = null;

  constructor(
    @InjectRepository(AuditLog)
    private readonly logs: Repository<AuditLog>,
  ) {}

  async list(query: AuditLogQueryDto): Promise<AuditLogListResponse> {
    const page = query.page;
    const limit = query.limit;

    const filtered = this.applyFilters(this.baseQuery(), query);
    const total = await filtered.clone().getCount();

    const sortExpression = SORT_EXPRESSIONS[query.sortBy ?? 'createdAt'];
    const direction = query.sortOrder === SORT_ORDER.ASC ? SORT_ORDER.ASC : SORT_ORDER.DESC;
    const [rows, meta] = await Promise.all([
      this.withListColumns(filtered)
        .orderBy(sortExpression, direction)
        .addOrderBy('audit.id', SORT_ORDER.DESC) // ties never reorder between requests
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany<RawAuditRow>(),
      this.filterOptions(),
    ]);

    return {
      items: rows.map((row) => this.toListItem(row)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      meta,
    };
  }

  /** The newest entries, for a recent-activity widget. */
  async recent(limit: number): Promise<AuditLogListItem[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), MAX_RECENT_AUDIT_ENTRIES);
    const rows = await this.withListColumns(this.baseQuery())
      .orderBy('audit.createdAt', SORT_ORDER.DESC)
      .addOrderBy('audit.id', SORT_ORDER.DESC)
      .limit(capped)
      .getRawMany<RawAuditRow>();
    return rows.map((row) => this.toListItem(row));
  }

  async findOne(id: number): Promise<AuditLogDetail> {
    const row = await this.withListColumns(this.baseQuery())
      .addSelect('audit.oldValue', 'oldValue')
      .addSelect('audit.newValue', 'newValue')
      .where('audit.id = :id', { id })
      .getRawOne<RawAuditRow>();
    if (!row) throw new NotFoundException(ERROR_MESSAGES.AUDIT_LOG_NOT_FOUND);

    return { ...this.toListItem(row), oldValue: parseAuditValue(row.oldValue), newValue: parseAuditValue(row.newValue) };
  }

  /** An audit row joined to its acting user. `withDeleted` so the name of a since-deleted account still shows. */
  private baseQuery(): SelectQueryBuilder<AuditLog> {
    return this.logs.createQueryBuilder('audit').withDeleted().leftJoin(User, 'actor', 'actor.id = audit.performedBy');
  }

  private withListColumns(qb: SelectQueryBuilder<AuditLog>): SelectQueryBuilder<AuditLog> {
    return qb
      .select('audit.id', 'id')
      .addSelect('audit.createdAt', 'createdAt')
      .addSelect('audit.moduleName', 'moduleName')
      .addSelect('audit.action', 'action')
      .addSelect('audit.entityId', 'entityId')
      .addSelect('audit.performedBy', 'performedBy')
      .addSelect('actor.firstName', 'actorFirstName')
      .addSelect('actor.lastName', 'actorLastName')
      .addSelect('actor.email', 'actorEmail')
      .addSelect('(audit.oldValue IS NOT NULL OR audit.newValue IS NOT NULL)', 'hasDetails');
  }

  private applyFilters(qb: SelectQueryBuilder<AuditLog>, query: AuditLogQueryDto): SelectQueryBuilder<AuditLog> {
    if (query.moduleName) qb.andWhere('audit.moduleName = :moduleName', { moduleName: query.moduleName });
    if (query.action) qb.andWhere('audit.action = :action', { action: query.action });
    if (query.performedBy !== undefined) qb.andWhere('audit.performedBy = :performedBy', { performedBy: query.performedBy });
    if (query.entityId !== undefined) qb.andWhere('audit.entityId = :entityId', { entityId: query.entityId });

    const from = query.dateFrom ? parseDay(query.dateFrom) : null;
    const to = query.dateTo ? parseDay(query.dateTo) : null;
    if ((query.dateFrom && !from) || (query.dateTo && !to)) {
      throw new BadRequestException('The date filter is not a real calendar date');
    }
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('"From" date must not be after "To" date');
    }
    if (from) qb.andWhere('audit.createdAt >= :dateFrom', { dateFrom: from });
    if (to) {
      const endExclusive = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
      qb.andWhere('audit.createdAt < :dateToExclusive', { dateToExclusive: endExclusive });
    }

    if (query.search?.trim()) {
      const term = normalizeSearchTerm(query.search);
      if (!term) throw new BadRequestException('Search text is too long');
      applyMultiWordSearch(qb, SEARCH_COLUMNS, term, 'auditSearch');
    }
    return qb;
  }

  private toListItem(row: RawAuditRow): AuditLogListItem {
    return {
      id: Number(row.id),
      createdAt: new Date(row.createdAt).toISOString(),
      moduleName: row.moduleName,
      moduleLabel: humanizeAuditToken(row.moduleName),
      action: row.action,
      actionLabel: humanizeAuditToken(row.action),
      entityId: row.entityId === null || row.entityId === undefined ? null : Number(row.entityId),
      performedBy: this.toActor(row),
      hasDetails: Number(row.hasDetails) === 1 || row.hasDetails === true,
    };
  }

  private toActor(row: RawAuditRow): AuditLogActor | null {
    if (row.performedBy === null || row.performedBy === undefined) return null;
    const fullName = [row.actorFirstName, row.actorLastName].filter(Boolean).join(' ').trim();
    return { id: Number(row.performedBy), name: fullName || row.actorEmail || null, email: row.actorEmail ?? null };
  }

  /** Every module name and action that exists in the trail, for the filter dropdowns (cached briefly). */
  private async filterOptions(): Promise<AuditLogListResponse['meta']> {
    if (this.filterOptionsCache && Date.now() - this.filterOptionsCache.at < AUDIT_FILTER_OPTIONS_TTL_MS) {
      return this.filterOptionsCache.value;
    }
    const distinct = (column: 'moduleName' | 'action') =>
      this.logs
        .createQueryBuilder('audit')
        .select(`DISTINCT audit.${column}`, 'value')
        .orderBy(`audit.${column}`, SORT_ORDER.ASC)
        .getRawMany<{ value: string }>();
    const [modules, actions] = await Promise.all([distinct('moduleName'), distinct('action')]);
    const toOptions = (rows: { value: string }[]): AuditLogFilterOption[] =>
      rows.filter((row) => row.value).map((row) => ({ value: row.value, label: humanizeAuditToken(row.value) }));

    const value = { modules: toOptions(modules), actions: toOptions(actions) };
    this.filterOptionsCache = { at: Date.now(), value };
    return value;
  }
}
