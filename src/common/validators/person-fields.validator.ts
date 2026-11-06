import { applyDecorators } from '@nestjs/common';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * The ONE rule for a person's name and mobile number. Every DTO that accepts them — the administrator's create / edit user
 * DTOs and the user's own profile DTO (Settings > My Profile) — builds on these, so the two ways of editing the same fields
 * can never drift apart.
 */

/** Longest first / middle / last name: the users.first_name, middle_name and last_name columns are varchar(100). */
export const NAME_MAX_LENGTH = 100;

/** International format: a "+" followed by 8 to 15 digits. */
export const MOBILE_E164_PATTERN = /^\+\d{8,15}$/;
export const MOBILE_E164_MESSAGE = 'Mobile number must be in international format. Example: +971501234567';

/**
 * Trims a string property.
 *
 * The global ValidationPipe runs with implicit conversion, which turns a JSON number, boolean or object into the text "123",
 * "true" or "[object Object]" BEFORE a custom transform runs — such a value would then pass @IsString and be stored as a
 * name. So it is the value the client really sent (obj[key]) that is trimmed here, not the converted one, and anything that
 * is not a string is handed on untouched for @IsString to reject. (Same approach as IsStrongPassword.)
 */
export function trimString({ obj, key }: TransformFnParams): unknown {
  const sent = (obj as Record<string, unknown>)[key];
  return typeof sent === 'string' ? sent.trim() : sent;
}

/** `@Trim()`: the property is trimmed on the way in (see trimString). Pair it with @IsString(). */
export function Trim(): PropertyDecorator {
  return Transform(trimString, { toClassOnly: true });
}

/**
 * A part of a person's name: trimmed, a real string, at most NAME_MAX_LENGTH characters. Required by default — a name that is
 * blank once trimmed is rejected (first and last name). `allowBlank` is for the optional middle name, where an empty value
 * simply means "none". Add @IsOptional() on the property when it may be left out altogether.
 */
export function IsPersonName(options: { allowBlank?: boolean } = {}) {
  return applyDecorators(
    Trim(),
    IsString(),
    MaxLength(NAME_MAX_LENGTH),
    ...(options.allowBlank ? [] : [IsNotEmpty()]),
  );
}

/** A mobile number in international format (see MOBILE_E164_PATTERN). */
export function IsMobileNumber() {
  return applyDecorators(IsString(), Matches(MOBILE_E164_PATTERN, { message: MOBILE_E164_MESSAGE }));
}
