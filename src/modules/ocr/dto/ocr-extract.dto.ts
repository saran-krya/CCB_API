import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class OcrExtractDto {
  @ApiProperty({ example: 'Emirates ID' })
  @IsString()
  @IsNotEmpty()
  documentType!: string;
}
