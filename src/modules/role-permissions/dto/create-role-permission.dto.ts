import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

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
export class UpdateRolePermissionDto extends PartialType(
    CreateRolePermissionDto,
) { }

export class SaveRolePermissionsDto {
    @ApiProperty()
    roleId!: number;

    @ApiProperty()
    screenPermissionList!: any[];
}