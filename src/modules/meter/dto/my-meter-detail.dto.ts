import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeterStatus } from '../entities/meter-status.enum';

/** The Sub Meter is the ONE meter that genuinely matters to a Customer — it's the meter physically
 *  tied to their own unit (Unit.subMeter, a real 1:1 relation). Master Meter is included only
 *  because it's the sub meter's own real, already-loaded parent (SubMeter.masterMeter) — never a
 *  separate feature — and stays intentionally minimal (code + status only): MasterMeter has no unit
 *  relation of its own at all (it belongs to the whole property, see MasterMeter's own doc comment),
 *  so nothing beyond "this is the meter upstream of yours, and here's whether it's active" is
 *  genuinely useful to a Customer. */
export class MySubMeterDto {
  @ApiProperty() id!: number;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty({ enum: MeterStatus }) status!: MeterStatus;
  @ApiPropertyOptional() floor!: number | null;
  @ApiPropertyOptional() meterMake!: string | null;
  @ApiPropertyOptional() meterModel!: string | null;
  @ApiPropertyOptional({ description: 'ISO-8601 date string' }) installationDate!: string | null;
}

export class MyMasterMeterDto {
  @ApiProperty() id!: number;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty({ enum: MeterStatus }) status!: MeterStatus;
}

export class MyMeterDetailDto {
  @ApiProperty() unitId!: number;
  @ApiProperty() unitNumber!: string;
  @ApiPropertyOptional({ type: () => MySubMeterDto, nullable: true }) subMeter!: MySubMeterDto | null;
  @ApiPropertyOptional({ type: () => MyMasterMeterDto, nullable: true }) masterMeter!: MyMasterMeterDto | null;
}
