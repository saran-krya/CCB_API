import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
} from 'class-validator';

export class CreateScreenDto {
    @ApiPropertyOptional({
        description: 'SubModule this screen belongs to. Provide either subModuleId or pModuleId.',
    })
    @IsOptional()
    @IsNumber()
    subModuleId?: number;

    @ApiPropertyOptional({
        description: 'PModule this screen belongs to directly (for PAGE-type modules with no SubModules). Provide either subModuleId or pModuleId.',
    })
    @IsOptional()
    @IsNumber()
    pModuleId?: number;

    @ApiProperty({ example: 'User Management' })
    @IsString()
    name!: string;

    @ApiProperty({ default: 0 })
    @IsOptional()
    @IsNumber()
    displayOrder?: number;

    @ApiProperty({ default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiProperty()
    @IsString()
    code!: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    url?: string;
}

export class UpdateScreenDto extends PartialType(CreateScreenDto) {}
