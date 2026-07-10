import { BadRequestException, ForbiddenException } from '@nestjs/common';

// Shared, entity-agnostic helpers extracted from the near-identical logic
// duplicated between TariffService and BillingCycleService — both modules
// implement the same "master + version" lifecycle (submit for review,
// Finance approves/rejects, self-review is blocked, versions bump a major
// version number) but have genuinely different status enums and entity
// shapes, so this stays at the level of pure functions rather than a forced
// generic base class.

// "1.0" -> "2.0", "2.0" -> "3.0", etc. Used by every module's newVersion()
// to bump the major version when cloning into a new draft/pending version.
export function nextMajorVersion(current: string): string {
  const major = parseInt(current.split('.')[0], 10);
  return `${Number.isFinite(major) ? major + 1 : 2}.0`;
}

// "1.0" -> "1.1", "1.1" -> "1.2", etc. Used for an in-place edit that doesn't
// warrant a full new version row (no clone, same identity) but still needs
// to be distinguishable from the version it changed — e.g. Tariff's "editing
// a live record's non-locked fields re-triggers approval" rule.
export function nextMinorVersion(current: string): string {
  const [majorPart, minorPart] = current.split('.');
  const major = parseInt(majorPart, 10);
  const minor = parseInt(minorPart, 10);
  return `${Number.isFinite(major) ? major : 1}.${Number.isFinite(minor) ? minor + 1 : 1}`;
}

// Blocks a reviewer from approving/rejecting their own submission — the
// same maker-checker rule enforced identically by TariffService and
// BillingCycleService. `submittedById` is the id already loaded onto the
// entity's `submittedBy` relation (or null if this version has none).
export function assertNotSelfReview(
  submittedById: number | null | undefined,
  actorId: number | undefined,
  action: string,
): void {
  if (actorId && submittedById === actorId) {
    throw new BadRequestException(
      `This item cannot be ${action} by the same user who submitted it. Ask another reviewer to action it.`,
    );
  }
}

// While an item awaits review, only the person who submitted it may edit it
// — editing it out from under the reviewer (or having a different admin
// silently change what's under review) defeats the point of the approval
// step. Callers exempt their own break-glass role by simply not calling
// this for that actor — this stays a plain ownership check with no role
// awareness (who may approve/reject at all is a Role Permissions decision,
// enforced by PermissionGuard at the route, not here).
export function assertSubmitterOnly(
  submittedById: number | null | undefined,
  actorId: number | undefined,
  action: string,
): void {
  if (actorId && submittedById && submittedById !== actorId) {
    throw new ForbiddenException(`Only the user who submitted this can ${action} it while it's pending review — ask them to make the change, or resubmit it yourself once corrected.`);
  }
}
