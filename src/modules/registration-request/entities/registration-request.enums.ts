// Shared enums referenced by RegistrationRequest and its split-out entities
// (RegistrationCustomerDetail in particular). Kept in their own file, separate from any entity
// class, so entities that reference each other's enums (e.g. RegistrationCustomerDetail needs
// RegistrationContactType, which used to live inside registration-request.entity.ts, which now
// also imports RegistrationCustomerDetail for the OneToOne relation) never form a circular
// module dependency — under ts-node's plain CommonJS require order a cycle like that leaves the
// enum still `undefined` at the moment a @Column({ enum: ... }) decorator evaluates, which
// TypeORM's metadata validator rejects outright ("missing enum or enumName properties").

export enum RegistrationChannel {
  CS = 'CS',
  RESIDENT_PORTAL = 'Resident Portal',
}

/**
 * Registration WORKFLOW stage only — Draft through the final Approved/Rejected outcome. Deliberately
 * excludes anything about the Security Deposit sub-process (see RegistrationDepositStatus below):
 * previously SECURITY_DEPOSIT_REQUESTED/DEPOSIT_PAID_PENDING_VERIFICATION lived in this same enum,
 * which forced every consumer to also check `request.customer != null` to know whether a given
 * occurrence of those two values meant "pre-approval legacy deposit flow" or "post-approval deposit
 * flow" — two different things sharing one status string. That ambiguity is why the deposit
 * sub-process was split into its own column entirely; a request's workflow stage and its deposit
 * state are now two independent facts, never inferred from each other.
 *
 * There is no separate "Business Approval" stage anymore — PENDING_BUSINESS_APPROVAL/RETURNED_TO_CS
 * (the "Loop 2" status a request could sit in on its way back from that stage) are retired, moved to
 * RETIRED_REGISTRATION_STATUSES below. Submission now lands directly in PENDING_CS_REVIEW, where the
 * ONE approve/reject decision (RegistrationRequestService.approve()/.reject(), still shared with the
 * Registration Approval queue — never duplicated) already happens; there is nothing left to submit
 * "for approval" to beyond that, and nothing to loop back from. The lifecycle is now: Submitted ->
 * Approve/Reject decision -> (if approved) Security Deposit -> Customer Pays -> Supervisor Verifies
 * -> Account Created/Activated automatically, with no manual step after verification.
 *
 * RESIDENT_COMMENTS_SUBMITTED was declared but never assigned anywhere in the service layer —
 * dropped as dead. RETIRED_REGISTRATION_STATUSES below documents every value ever stored under the
 * old, wider enum so historical rows/history entries remain interpretable.
 */
export enum RegistrationRequestStatus {
  DRAFT = 'Draft',
  SENT_TO_RESIDENT = 'Sent to Resident for Review',
  PENDING_CS_REVIEW = 'Pending CS Review',
  RETURNED_TO_RESIDENT = 'Returned to Resident for Correction',
  APPROVED = 'Approved',
  REJECTED = 'Rejected',
}

/** Values `RegistrationRequestStatus` used to carry before the deposit sub-process was split out, OR
 *  before the separate Business Approval stage (PENDING_BUSINESS_APPROVAL/RETURNED_TO_CS) was
 *  removed — kept only so a raw historical `registration_workflow_history`/audit-log row containing
 *  one of these strings remains interpretable. Never assign these; never add new members here. */
export const RETIRED_REGISTRATION_STATUSES = [
  'Security Deposit Requested',
  'Deposit Paid - Pending CS Verification',
  'Resident Comments Submitted',
  'Pending Business Approval',
  'Returned to CS for Correction',
] as const;

/**
 * The Security Deposit sub-process, as its OWN field — independent of the request's workflow
 * `status`. `null` means the deposit question hasn't been decided yet (pre-approval). Once decided
 * (always post-approval, per the current business flow), it is either NOT_REQUIRED (terminal — no
 * deposit applies) or begins the REQUESTED → PAID_PENDING_VERIFICATION → VERIFIED progression.
 * This single column replaces what used to be spread across three places (RegistrationRequest.status
 * itself, RegistrationDemand.status, RegistrationDeposit.status) and manually kept in sync by every
 * service method that touched any one of them — RegistrationDemand/RegistrationDeposit still track
 * their own ledger-accurate internal states, but this is the one field the API/UI reads for "what's
 * the deposit state right now".
 */
export enum RegistrationDepositStatus {
  NOT_REQUIRED = 'Not Required',
  REQUESTED = 'Requested',
  PAID_PENDING_VERIFICATION = 'Paid - Pending Verification',
  VERIFIED = 'Verified',
}

/**
 * THE one rule for "is the deposit sub-process fully resolved" — both of its two terminal-good
 * values (never required at all, or verified). Used by CustomerService.activate() to decide whether
 * a Not-Required Customer should activate immediately, and by the staff RegistrationWizard's own
 * `depositVerified` boolean (kept conceptually identical there, see useRegistrationCreation.ts).
 * Deliberately does NOT decide Customer Portal access on its own anymore — see computePortalAccess
 * below for that (accountStatus === ACTIVE must also hold for the Verified case, since verification
 * alone no longer implies the account has actually been flipped active — RegistrationRequestService.
 * verifyDeposit() sets both in the same transaction, but a caller deciding portal access must check
 * the real column, never assume the two can't have drifted).
 */
export function isDepositResolved(status: RegistrationDepositStatus | null): boolean {
  return status === RegistrationDepositStatus.NOT_REQUIRED || status === RegistrationDepositStatus.VERIFIED;
}

/**
 * THE single rule for "may this Customer session use the full Customer Portal" —
 * CustomerAccessGuard and AuthService.bootstrap's `portalAccess` field both call this, never
 * re-derive it. Takes `accountStatus` as a plain string (not the Customer module's own enum) quite
 * deliberately: this file is shared, low-level enum plumbing (see this file's own header comment on
 * why cross-module enum imports here specifically caused a real `undefined`-at-decorator-evaluation
 * bug before) — a raw `'active'` comparison costs nothing and keeps this file free of any import
 * from the customer module.
 *
 * Corrected lifecycle rule (deposit Verified is NOT enough on its own — accountStatus must have
 * actually reached ACTIVE too, which only RegistrationRequestService.verifyDeposit() sets):
 *   - Not Required            → full (no payment/verification step to wait on at all)
 *   - Verified AND ACTIVE     → full
 *   - anything else           → restricted (Requested, Paid - Pending Verification, no request on
 *     file, or the — should-never-happen — case of Verified without accountStatus having caught up)
 */
export function computePortalAccess(
  depositStatus: RegistrationDepositStatus | null,
  accountStatus: string | null | undefined,
): 'restricted' | 'full' {
  if (depositStatus === RegistrationDepositStatus.NOT_REQUIRED) return 'full';
  if (depositStatus === RegistrationDepositStatus.VERIFIED && accountStatus === 'active') return 'full';
  return 'restricted';
}

export enum RegistrationResidentType {
  OWNER = 'Owner',
  TENANT = 'Tenant',
}

export enum RegistrationUnitType {
  RESIDENTIAL = 'Residential',
  COMMERCIAL = 'Commercial',
}

export enum RegistrationAccountType {
  INDIVIDUAL = 'Individual',
  CORPORATE = 'Corporate',
}

export enum RegistrationContactType {
  SELF = 'Self',
  AUTHORIZED_REPRESENTATIVE = 'Authorized Representative',
  MANAGER_ON_LICENSE = 'Manager on License',
}

export enum RegistrationLegalStructure {
  LLC = 'LLC',
  FREE_ZONE_COMPANY = 'Free Zone Company',
  SOLE_ESTABLISHMENT = 'Sole Establishment',
  BRANCH_OF_FOREIGN_COMPANY = 'Branch of Foreign Company',
}

export enum ActivationInviteStatus {
  PENDING_INVITE = 'Pending Invite',
}

export enum RegistrationDepositPaymentStatus {
  PENDING = 'Pending',
  PAID = 'Paid',
}
