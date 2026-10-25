import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class CreateRolePermissionDto {
    @ApiProperty()
    @IsNumber()
    roleId!: number;

    @ApiProperty()
    @IsNumber()
    moduleId!: number;

    @ApiProperty()
    @IsNumber()
    subModuleId!: number;

    @ApiProperty()
    @IsNumber()
    screenId!: number;

    @ApiProperty()
    @IsNumber()
    actionId!: number;
}