import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsMobileNumber, IsPersonName } from '../../../common/validators/person-fields.validator';

/**
 * What a user may change about THEMSELVES (Settings > My Profile): their name and mobile number. The e-mail address is the
 * sign-in identity, and the employee code, designation, roles and active flag are administrator-managed (EDIT_USER), so none
 * of those is accepted here — the global validation pipe rejects any field not listed.
 */
export class UpdateOwnProfileDto {
  // The name and mobile rules are the SAME ones the administrator's create / edit user DTO applies (person-fields.validator).
  @ApiPropertyOptional({ example: 'Fernando' })
  @IsOptional()
  @IsPersonName()
  firstName?: string;

  @ApiPropertyOptional({ example: 'A' })
  @IsOptional()
  @IsPersonName({ allowBlank: true })
  middleName?: string;

  @ApiPropertyOptional({ example: 'Jamil' })
  @IsOptional()
  @IsPersonName()
  lastName?: string;

  @ApiPropertyOptional({ example: '+971501234567' })
  @IsOptional()
  @IsMobileNumber()
  mobile?: string;
}
