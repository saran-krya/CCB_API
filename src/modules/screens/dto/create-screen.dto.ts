import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
} from 'class-validator';

export class CreateScreenDto {
    @ApiProperty()
    @IsNumber()
    subModuleId!: number;

    @ApiProperty({
        example: 'User Management',
    })
    @IsString()
    name!: string;

    @ApiProperty({
        default: 0,
    })
    @IsOptional()
    @IsNumber()
    displayOrder?: number;

    @ApiProperty({
        default: true,
    })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiProperty()
    @IsString()
    code!: string;

    @ApiProperty({
        required: false,
    })
    @IsOptional()
    @IsString()
    url?: string;
}

export class UpdateScreenDto extends PartialType(
    CreateScreenDto,
) { }