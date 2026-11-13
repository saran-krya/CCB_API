import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
    IsNotEmpty,
    MaxLength,
    Min,
} from 'class-validator';

export class CreateSubModuleDto {
    @ApiProperty()
    @IsNumber()
    pModuleId!: number;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    @MaxLength(150)
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
    @Min(0)
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