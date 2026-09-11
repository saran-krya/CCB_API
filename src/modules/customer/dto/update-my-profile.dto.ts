import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The narrow, self-service subset of CustomerDetailDto a Customer may edit about themselves via
 * PATCH /me/profile — deliberately excludes every identity/relationship/lifecycle field
 * (id/businessCode/residentType/accountStatus/accountType/unit-property-community/paymentMethods/
 * autoPayEnabled/etc.) since those are staff-controlled or derived from the registration/unit
 * relationship, never customer-editable. Every field here is optional so a partial update (e.g. just
 * changing a phone number) doesn't require resending the whole profile.
 */
export class UpdateMyProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @ApiPropertyOptional({ description: 'ISO-8601 date string' }) @IsOptional() @IsString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) nationality?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) preferredLanguage?: string;
}
