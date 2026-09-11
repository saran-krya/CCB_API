import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt } from 'class-validator';
import { ResidentType } from '../entities/customer.entity';

export class OpenForTenantQueryDto {
  @ApiProperty({
    type: [Number],
    description: 'Repeat as ?unitIds=1&unitIds=2, or a single comma-separated ?unitIds=1,2',
  })
  @Transform(({ value }) => {
    const arr = Array.isArray(value) ? value : String(value).split(',');
    return arr.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
  })
  @Type(() => Number)
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  unitIds!: number[];
}

export class UnitResidentConflictQueryDto extends OpenForTenantQueryDto {
  @ApiProperty({ enum: ResidentType, description: 'Resident type of the registration being checked' })
  @IsEnum(ResidentType)
  residentType!: ResidentType;
}
