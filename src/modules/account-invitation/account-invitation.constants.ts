import { PRINCIPAL_TYPE, PrincipalType } from '../../common/constants/auth.constants';

/** The kind of account an invitation is for. The same two values as the session kinds: a staff user or a customer (portal) account. */
export const INVITATION_PRINCIPAL = PRINCIPAL_TYPE;
export type InvitationPrincipal = PrincipalType;
export const INVITATION_PRINCIPAL_VALUES: readonly string[] = [PRINCIPAL_TYPE.STAFF, PRINCIPAL_TYPE.CUSTOMER];

export const INVITATION_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];
export const INVITATION_STATUS_VALUES: readonly string[] = Object.values(INVITATION_STATUS);

/** How long an invitation link works. Fixed by the security requirement (24 hours) — deliberately not configurable, so a setting can never
 *  turn it into a long-lived credential. The expiry is stamped and compared with the DATABASE clock. */
export const INVITATION_LIFETIME_HOURS = 24;

/** Limits on sending: a link can be re-sent at most once a minute and at most INVITATION_MAX_SENDS times in all, and one administrator can
 *  create only so many invitations an hour. These are on top of the per-IP request limits. */
export const INVITATION_RESEND_COOLDOWN_SECONDS = 60;
export const INVITATION_MAX_SENDS = 20;
export const INVITATION_MAX_CREATED_PER_ACTOR_PER_HOUR = 60;

/** The longest error text kept from a failed delivery. */
export const INVITATION_SEND_ERROR_MAX_LENGTH = 400;

/** Why a pending invitation was cancelled by the system rather than by an administrator. */
export const INVITATION_CANCEL_REASON = {
  ADMINISTRATOR: 'ADMINISTRATOR',
  ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  ACCOUNT_NOT_AWAITING_SETUP: 'ACCOUNT_NOT_AWAITING_SETUP',
} as const;

export const INVITATION_AUDIT_MODULE = 'account_invitations';

export const INVITATION_AUDIT_ACTION = {
  CREATED: 'INVITATION_CREATED',
  RESENT: 'INVITATION_RESENT',
  ACCEPTED: 'INVITATION_ACCEPTED',
  EXPIRED: 'INVITATION_EXPIRED',
  CANCELLED: 'INVITATION_CANCELLED',
  SEND_FAILED: 'INVITATION_SEND_FAILED',
} as const;

/** The e-mail purpose labels written to the send log. They name the kind of mail, never its content or link. */
export const INVITATION_MAIL_PURPOSE = {
  INVITATION: 'account invitation',
  EXPIRED: 'invitation expired',
  ACTIVATED: 'account activated',
} as const;

/** The environment variables that say where invitation links point: the web application's public address. A staff invitation uses
 *  STAFF_PORTAL_URL, falling back to CUSTOMER_PORTAL_URL (one web application serves both); a customer invitation uses CUSTOMER_PORTAL_URL.
 *  There is no default and the request's own Host header is never used. */
export const INVITATION_ENV = {
  STAFF_PORTAL_URL: 'STAFF_PORTAL_URL',
  CUSTOMER_PORTAL_URL: 'CUSTOMER_PORTAL_URL',
} as const;

/** The web paths an invitation link and the follow-up mail point at. */
export const INVITATION_WEB_PATH = {
  ACCEPT: '/accept-invitation',
  SIGN_IN: '/login',
} as const;

/** Every refusal of a public link says the same thing, whatever the reason (unknown, used, expired, cancelled, account changed), so the answer
 *  tells nobody which links exist. */
export const INVITATION_MESSAGE = {
  INVALID_LINK: 'This invitation link is invalid or has expired.',
  NOT_FOUND: 'Invitation not found',
  ACCOUNT_NOT_AWAITING_SETUP: 'This account has already been set up, so it cannot be invited again.',
  RESEND_TOO_SOON: 'An invitation was sent a moment ago. Please wait a minute before sending it again.',
  TOO_MANY_SENDS: 'This invitation has been sent too many times. Cancel it and invite the person again if they still need access.',
  TOO_MANY_CREATED: 'Too many invitations were created in the last hour. Please try again later.',
  PORTAL_URL_MISSING:
    'The web address for invitation links is not configured (set STAFF_PORTAL_URL or CUSTOMER_PORTAL_URL), so the invitation e-mail could not be sent.',
  PORTAL_URL_INVALID: 'The web address configured for invitation links is not a valid http(s) address, so the invitation e-mail could not be sent.',
  PORTAL_URL_NOT_HTTPS: 'Invitation links must use https in production; the configured web address does not, so the invitation e-mail could not be sent.',
  NO_EMAIL: 'This account has no e-mail address to send an invitation to.',
  MAY_NOT_VIEW: 'You do not have permission to view these invitations.',
  MAY_NOT_MANAGE: 'You do not have permission to manage this kind of invitation.',
  STAFF_SUPER_ADMIN_ONLY: 'Only a SUPER_ADMIN can invite, re-send to, cancel for or list staff accounts.',
  MAY_NOT_ISSUE_STAFF_LINK:
    'Sending an invitation to an existing staff account needs both the edit-user and the reset-password permissions, because whoever opens the link chooses that account\'s password.',
} as const;
