import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAuditLogDto {
  @ApiProperty({
    example: 'Ticket',
    description: 'Module name',
  })
  moduleName!: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Related entity id',
  })
  entityId?: number | null;

  @ApiProperty({
    example: 'CREATE',
    description: 'Action performed',
  })
  action!: string;

  @ApiPropertyOptional({
    example: { status: 'Pending' },
    description: 'Previous value',
  })
  oldValue?: unknown;

  @ApiPropertyOptional({
    example: { status: 'Approved' },
    description: 'New value',
  })
  newValue?: unknown;

  @ApiPropertyOptional({
    description: 'User who performed the action',
  })
  performedBy?: number | null;
}