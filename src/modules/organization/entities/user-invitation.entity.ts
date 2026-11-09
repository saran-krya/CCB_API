import { Column, Entity, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organization } from './organization.entity';
import { User } from '../../user/entities/user.entity';

/**
 * Tracks a Tenant ADMIN invitation end to end — mirrors the *pattern* of the existing
 * CustomerActivationToken (token hash, expiry, used-at) without reusing that table directly, since it's
 * FK'd to Customer, not User. `tokenHash` is a SHA-256 of the raw token mailed to the invitee; the raw
 * token is never persisted (same posture as refresh tokens elsewhere in this codebase). `userId` points
 * at the User row created at invite time (status PENDING_ACTIVATION) — activation flips that status and
 * stamps `usedAt`, and the organization the new session resolves to always comes from `organizationId`
 * on THIS row, never from anything the activation request itself supplies.
 */
@Entity('user_invitations')
export class UserInvitation extends BaseEntity {
  @ManyToOne(() => Organization, { nullable: false })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'invited_email', type: 'varchar', length: 160 })
  invitedEmail!: string;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 128 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt?: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'invited_by_id' })
  invitedBy?: User | null;

  @Column({ name: 'invited_by_id', type: 'int', nullable: true })
  invitedById?: number | null;
}
