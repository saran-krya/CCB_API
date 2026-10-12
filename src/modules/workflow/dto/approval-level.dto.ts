import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDefined, IsOptional, ValidateNested } from 'class-validator';

// Mirrors CCB_Template's ApprovalLevel shape exactly — see WorkflowApprovalLevel entity's own doc
// comment on why this is a policy record, not the real approve permission.
//
// Deliberately LOOSE on the RULES at the DTO layer — every field below carries only @IsDefined,
// which exists ONLY to keep forbidNonWhitelisted (the global ValidationPipe) from silently
// stripping these properties before the service ever sees them; it enforces nothing about VALUE
// (not "a positive whole number", not "a known approver role or enum member"). The real rules
// (role existence, SLA a positive whole number, department/unit/breach a known value) are ALL
// enforced in WorkflowService.updateApprovalPolicy's own assertLevels check, which reports EVERY
// problem across EVERY level in ONE message, by level number — exactly CCB_Template's own
// _assertLevels contract (never "which field first failed decorator validation"). Splitting the
// rule across scattered decorators is exactly how a disabled button and a thrown guard start
// disagreeing — see that method's own doc comment.
export class ApprovalLevelDto {
  @ApiProperty()
  @IsDefined({ message: 'roleId must be present' })
  roleId!: unknown;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  department!: unknown;

  @ApiProperty()
  @IsDefined({ message: 'slaValue must be present' })
  slaValue!: unknown;

  @ApiProperty()
  @IsDefined({ message: 'slaUnit must be present' })
  slaUnit!: unknown;

  @ApiProperty()
  @IsDefined({ message: 'onBreach must be present' })
  onBreach!: unknown;
}

// REPLACE semantics, never merge — the caller submits the whole intended sequence. See
// WorkflowService.updateApprovalPolicy's own doc comment (mirrors the Template's
// updateApprovalLevels contract exactly: an approval workflow's meaning IS its order).
export class UpdateApprovalLevelsDto {
  @ApiProperty({ type: [ApprovalLevelDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'An approval workflow needs at least one level.' })
  @ValidateNested({ each: true })
  @Type(() => ApprovalLevelDto)
  levels!: ApprovalLevelDto[];
}
