import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { registerDecorator, ValidationOptions } from 'class-validator';

/** The shortest password accepted, in characters. */
export const PASSWORD_MIN_LENGTH = 12;

/** The longest password accepted, in UTF-8 BYTES — not characters. Every stored password is hashed with bcrypt
 *  (bcryptjs), which reads only the first 72 bytes of the UTF-8 encoded text and silently ignores the rest: a longer
 *  password would verify against its first 72 bytes alone, so it would only LOOK stronger. An English letter, digit or
 *  symbol is 1 byte, an Arabic or other non-Latin letter 2 or more (about 36 Arabic letters reach the limit). Existing
 *  hashes are unaffected — bcrypt has always ignored everything after byte 72 — so nobody has to change a password. */
export const PASSWORD_MAX_BYTES = 72;

/** The same value as PASSWORD_MAX_BYTES, kept only so existing importers (GET /settings/system's
 *  `passwordPolicy.maxLength`) keep compiling. It is a BYTE count, not a character count: a string of at most
 *  PASSWORD_MAX_BYTES bytes also has at most that many characters, which is why it stays a valid upper bound where a
 *  character count is expected (OpenAPI `maxLength`).
 *  @deprecated Use PASSWORD_MAX_BYTES. */
export const PASSWORD_MAX_LENGTH = PASSWORD_MAX_BYTES;

/** How many of the four character types (uppercase, lowercase, number, symbol) a password must contain. Exported so that
 *  whatever REPORTS the rule (Settings > System > Security) reads this number instead of repeating it. */
export const REQUIRED_CHARACTER_CLASSES = 3;

/** The one sentence shown to users (API error and web UI hint) so the rule is stated identically
 *  everywhere. Keep it in step with passwordPolicyViolations below. */
export const PASSWORD_POLICY_MESSAGE =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters and at most ${PASSWORD_MAX_BYTES} bytes ` +
  '(an English letter, digit or symbol is 1 byte; an Arabic or other non-Latin letter is 2 or more) ' +
  `and include at least ${REQUIRED_CHARACTER_CLASSES} of: uppercase letters, lowercase letters, numbers, symbols.`;

const CHARACTER_CLASSES = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];

/** Every way `password` fails the policy (empty = acceptable): at least 12 characters, at most 72 UTF-8 bytes, at least
 *  three of the four character classes, and not a single repeated character. Pure, so the same rule is reused by the
 *  DTO decorator, the server-side password generator and the bootstrap admin check.
 *
 *  The ceiling is measured on the UTF-8 encoding because that is what bcrypt consumes (see PASSWORD_MAX_BYTES).
 *  Buffer.byteLength equals the bytes bcryptjs reads for any well-formed text and is never lower for a malformed one, so
 *  nothing beyond the 72nd byte can be accepted and then ignored. */
export function passwordPolicyViolations(password: unknown): string[] {
  if (typeof password !== 'string') return ['Password must be a string.'];
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) problems.push(`at most ${PASSWORD_MAX_BYTES} bytes`);
  if (CHARACTER_CLASSES.filter((pattern) => pattern.test(password)).length < REQUIRED_CHARACTER_CLASSES) {
    problems.push(`${REQUIRED_CHARACTER_CLASSES} of the 4 character types`);
  }
  if (password.length > 0 && /^(.)\1+$/.test(password)) problems.push('not one repeated character');
  return problems;
}

export const isStrongPassword = (password: unknown): boolean => passwordPolicyViolations(password).length === 0;

/** class-validator decorator applying the password policy (a 400 carrying PASSWORD_POLICY_MESSAGE).
 *
 *  The global ValidationPipe runs with implicit conversion, which would turn a JSON object into the text
 *  "[object Object]" (15 characters, three character types: a password that passes the policy and that anyone
 *  could guess) and a JSON number into its decimal text. So the value the client really sent is handed to the
 *  validator untouched: anything that is not a string is rejected, never coerced into one. */
export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return applyDecorators(
    Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (object: any, propertyName: string | symbol) =>
      registerDecorator({
        name: 'isStrongPassword',
        target: object.constructor,
        propertyName: propertyName as string,
        options: { message: PASSWORD_POLICY_MESSAGE, ...validationOptions },
        validator: { validate: (value: unknown) => isStrongPassword(value) },
      }),
  );
}
