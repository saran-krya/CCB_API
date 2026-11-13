import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
    IsIn,
    IsNotEmpty,
    MaxLength,
    Min,
} from 'class-validator';

export class CreatePModuleDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    @MaxLength(150)
    moduleName!: string;

    @ApiProperty({
        required: false,
    })
    @IsOptional()
    @IsString()
    icon?: string;

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
    
    @ApiProperty()
    @IsString()
    code!: string;


    @ApiProperty({
        example: 'MENU',
        enum: ['MENU', 'PAGE'],
        default: 'MENU',
    })
    @IsOptional()
    @IsString()
    @IsIn(['MENU', 'PAGE'])
    type?: string;

    @ApiProperty({
        required: false,
        example: '/community-management',
    })
    @IsOptional()
    @IsString()
    url?: string;
}

export class UpdatePModuleDto extends PartialType(
    CreatePModuleDto,
) { }