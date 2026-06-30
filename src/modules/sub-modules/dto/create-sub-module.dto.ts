import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
} from 'class-validator';

export class CreateSubModuleDto {
    @ApiProperty()
    @IsNumber()
    pModuleId!: number;

    @ApiProperty()
    @IsString()
    name!: string;

    @ApiProperty()
    @IsString()
    code!: string;

    @ApiProperty({
        required: false,
    })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiProperty({
        required: false,
    })
    @IsOptional()
    @IsString()
    url?: string;


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
}

export class UpdateSubModuleDto extends PartialType(
    CreateSubModuleDto,
) { }