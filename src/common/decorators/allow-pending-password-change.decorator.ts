import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';

/**
 * Marks a route a staff user may still call while a password change is REQUIRED (`mustChangePassword`):
 * changing the password itself, signing out, and the read-only calls the app shell makes to learn who
 * the user is. Every other route answers 403 `PASSWORD_CHANGE_REQUIRED` until the password is changed
 * (PasswordChangeGuard). Keep this list as short as the shell genuinely needs — it must never include a
 * route that returns or changes business data.
 */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);
