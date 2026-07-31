import { BadRequestException, ForbiddenException } from '@nestjs/common';

export function nextMajorVersion(current: string): string {
  const major = parseInt(current.split('.')[0], 10);
  return `${Number.isFinite(major) ? major + 1 : 2}.0`;
}

export function nextMinorVersion(current: string): string {
  const [majorPart, minorPart] = current.split('.');
  const major = parseInt(majorPart, 10);
  const minor = parseInt(minorPart, 10);
  return `${Number.isFinite(major) ? major : 1}.${Number.isFinite(minor) ? minor + 1 : 1}`;
}

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

export function assertSubmitterOnly(
  submittedById: number | null | undefined,
  actorId: number | undefined,
  action: string,
): void {
  if (actorId && submittedById && submittedById !== actorId) {
    throw new ForbiddenException(`Only the user who submitted this can ${action} it while it's pending review — ask them to make the change, or resubmit it yourself once corrected.`);
  }
}
