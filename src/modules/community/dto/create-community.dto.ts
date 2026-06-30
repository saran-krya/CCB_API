import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCommunityDto {
  @ApiProperty({ example: 'Dubai Marina' })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'DM' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  status?: boolean;
}

export class UpdateCommunityDto extends PartialType(CreateCommunityDto) {}