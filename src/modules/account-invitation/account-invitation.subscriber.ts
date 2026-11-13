import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, ObjectLiteral, SoftRemoveEvent, UpdateEvent } from 'typeorm';
import { Customer } from '../customer/entities/customer.entity';
import { User } from '../user/entities/user.entity';
import { INVITATION_CANCEL_REASON, INVITATION_PRINCIPAL, InvitationPrincipal } from './account-invitation.constants';
import { AccountInvitationService } from './account-invitation.service';

/**
 * Withdraws a pending invitation when its account changes under it: its e-mail is edited, a staff account is activated or deactivated, or
 * either kind of account is deleted. The link was sent to a particular address for an account in a particular state; once either has
 * changed it must not work any more.
 *
 * It listens to TypeORM's own change events instead of being called from the user and customer services, so those services stay exactly
 * as they are — and it exists only while the invitation module is switched on. The events fire INSIDE the transaction that made the change,
 * and the cancellation uses that same transaction (`event.manager`), so the change and the cancellation commit or roll back together.
 * Only changes made by `save()` / `softRemove()` (every admin edit and delete) name their changed columns; a query-builder update such as
 * the invitation's own acceptance names none and is ignored — which is exactly right.
 */
@Injectable()
export class AccountInvitationSubscriber implements EntitySubscriberInterface {
  constructor(
    dataSource: DataSource,
    private readonly invitations: AccountInvitationService,
  ) {
    dataSource.subscribers.push(this);
  }

  async afterUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> {
    const type = this.principalTypeOf(event.metadata.target);
    if (type === null) return;

    const changed = new Set((event.updatedColumns ?? []).map((column) => column.propertyName));
    // A staff account is also taken out of "waiting for setup" by being activated; a customer's status has its own rules, so only its address counts.
    const relevant = type === INVITATION_PRINCIPAL.STAFF ? changed.has('email') || changed.has('active') : changed.has('email');
    if (!relevant) return;

    const id = this.idOf(event.entity) ?? this.idOf(event.databaseEntity);
    if (id === null) return;
    await this.invitations.cancelForAccount(type, id, INVITATION_CANCEL_REASON.ACCOUNT_CHANGED, event.manager);
  }

  async afterSoftRemove(event: SoftRemoveEvent<ObjectLiteral>): Promise<void> {
    const type = this.principalTypeOf(event.metadata.target);
    if (type === null) return;
    const id = this.idOf(event.entity) ?? this.idOf(event.databaseEntity);
    if (id === null) return;
    await this.invitations.cancelForAccount(type, id, INVITATION_CANCEL_REASON.ACCOUNT_DELETED, event.manager);
  }

  private principalTypeOf(target: unknown): InvitationPrincipal | null {
    if (target === User) return INVITATION_PRINCIPAL.STAFF;
    if (target === Customer) return INVITATION_PRINCIPAL.CUSTOMER;
    return null;
  }

  private idOf(entity: ObjectLiteral | undefined): number | null {
    const id = entity?.id;
    return typeof id === 'number' ? id : null;
  }
}
