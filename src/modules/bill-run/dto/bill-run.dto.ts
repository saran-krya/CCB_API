import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { BillRunStatus } from '../entities/bill-run.entity';

export class SubmitBillRunDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  propertyId!: number;

  // Missed Reading Recovery — when supplied, the property's reading-period for THIS submission is
  // resolved from this specific past date via BillingCycleService.resolveVersionForReadingDate,
  // instead of the routine getReadingPeriodForProperty's always-anchored-to-today resolution. A
  // client NEVER supplies a cycleVersionId or explicit period directly — only the reading's own
  // date, so the server (not the caller) is the one deciding which billing-cycle version and period
  // that date actually resolves to; see submitWithinTransaction's own doc comment on why trusting a
  // client-supplied version/date pair outright would be unsafe. Omitted entirely, routine (today's
  // current-cycle) behavior is completely unaffected — this is purely additive.
  @ApiPropertyOptional({ description: 'A past reading date to resolve and bill for recovery, instead of the current cycle (e.g. "2026-09-28"). Omit for routine current-cycle submission.' })
  @IsOptional()
  @IsDateString()
  readingDate?: string;

  // Required (and only meaningful) when readingDate is supplied — checkRecoveredReadingEligibility's
  // own `occupantVerificationRequired` is unconditionally true for every unit in a past-period
  // submission (the schema has no point-in-time occupancy history, so "who occupies this unit now"
  // can never be verified as "who occupied it during the historical period" — see that method's own
  // doc comment). That field is informational there, not a block — THIS is the actual enforcement
  // point: submission for a past period is refused unless the submitter explicitly attests the
  // current occupant is confirmed correct for the historical period, recorded as part of this
  // request. Never read for a routine (no readingDate) submission.
  @ApiPropertyOptional({ description: 'Required when readingDate is supplied: explicit attestation that the current occupant is confirmed correct for the historical period.' })
  @IsOptional()
  @IsBoolean()
  occupantVerificationConfirmed?: boolean;

  @ApiPropertyOptional({ description: 'Optional notes for the reviewer' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// Deliberately has no propertyId — resubmit always re-targets the ORIGINAL row's own property (see
// BillRunService.resubmit), so forcing a caller to repeat a value that's already known and can only
// ever be ignored would just invite a mismatched value silently doing nothing.
export class ResubmitBillRunDto {
  @ApiPropertyOptional({ description: 'Optional notes for the reviewer' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SubmitBatchBillRunDto {
  @ApiProperty({ type: [Number], description: 'Every property to submit together as one batch' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  propertyIds!: number[];

  @ApiPropertyOptional({ description: 'Optional notes for the reviewer, applied to every run in the batch' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReviewBillRunDto {
  @ApiPropertyOptional({ description: 'Reviewer notes/remarks' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReturnBillRunDto {
  @ApiProperty({ description: 'Required — explains what needs correcting' })
  @IsString()
  notes!: string;
}

export class RejectBillRunDto {
  @ApiProperty({ description: 'Required — reason for rejection' })
  @IsString()
  notes!: string;
}

export class BillRunQueryDto extends BasePaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  propertyId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  communityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  batchId?: number;

  @ApiPropertyOptional({ enum: BillRunStatus })
  @IsOptional()
  @IsEnum(BillRunStatus)
  status?: BillRunStatus;

  // Period-wise Billing History — filters on the BillRun's OWN billing period (cyclePeriodStart),
  // never on submittedOn/createdAt. A run submitted today can belong to a period from months ago
  // (e.g. a Missed Reading Recovery submission) — this filter answers "which period does this run
  // bill for," a genuinely different question from "when was it submitted."
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Only runs whose cyclePeriodStart is on or after this date' })
  @IsOptional()
  @IsDateString()
  periodFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Only runs whose cyclePeriodStart is on or before this date' })
  @IsOptional()
  @IsDateString()
  periodTo?: string;
}

// Global Past Billing Overview — one row per (property, missed/historical cycle version), estate-
// wide. Filters mirror BillRunQueryDto's own (same propertyId/communityId/periodFrom/periodTo
// shape), minus `batchId` — doesn't apply to a row that may have no bill run at all.
//
// `overviewStatus` deliberately mirrors the real BillRunStatus enum exactly for the 4 "a bill run
// exists" cases (PENDING_APPROVAL/RETURNED_FOR_CORRECTION/REJECTED/APPROVED), plus 2 values for "no
// bill run exists at all" (MISSING_BILL_RUN/BLOCKED) that have no BillRunStatus equivalent. Earlier
// revision of this enum collapsed REJECTED/RETURNED_FOR_CORRECTION into PENDING_APPROVAL — a real
// bug: it made a rejected historical bill run display as still awaiting approval, which could read
// as "action still needed/pending" when the real terminal status is REJECTED. Never collapse a real
// BillRunStatus value into a different one here again — add a case instead.
export enum PastBillingOverviewStatus {
  MISSING_BILL_RUN = 'missing_bill_run',
  BLOCKED = 'blocked',
  PENDING_APPROVAL = 'pending_approval',
  RETURNED_FOR_CORRECTION = 'returned_for_correction',
  REJECTED = 'rejected',
  APPROVED = 'approved',
}

export class PastBillingOverviewQueryDto extends BasePaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  propertyId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  communityId?: number;

  @ApiPropertyOptional({ enum: PastBillingOverviewStatus })
  @IsOptional()
  @IsEnum(PastBillingOverviewStatus)
  overviewStatus?: PastBillingOverviewStatus;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Only periods whose periodStart is on or after this date' })
  @IsOptional()
  @IsDateString()
  periodFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Only periods whose periodStart is on or before this date' })
  @IsOptional()
  @IsDateString()
  periodTo?: string;
}
