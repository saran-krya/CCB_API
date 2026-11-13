import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * The invitation of ONE account (a staff user or a customer) to set up its own password. There is one row per account: sending again re-opens
 * it with a new token and a new expiry rather than adding rows, so at most one link can ever work, and the row's status is the account's
 * invitation status (PENDING, ACCEPTED, EXPIRED, CANCELLED). The history of each send, resend, acceptance, expiry and cancellation is in the
 * audit log.
 *
 * Only the SHA-256 of the token is stored (same recipe as refresh tokens and customer activation links), so a database read can never yield a
 * usable link; the token itself exists only in the e-mailed link. Expiry and the single-use claim use the DATABASE clock (`NOW(6)`).
 *
 * `principal_type` + `principal_id` follow the convention of `refresh_tokens` and `user_devices` — a staff user id and a customer id are two
 * independent id spaces, so every query filters on both — and carry no foreign key, so the table references neither entity. The table is created
 * by migration 1795600000000; keep this entity and that migration identical (TypeORM's schema comparison must stay at 0 pending changes).
 */
@Entity('account_invitations')
@Index('UQ_account_invitations_principal', ['principalType', 'principalId'], { unique: true })
@Index('IDX_account_invitations_status_expires', ['status', 'expiresAt'])
export class AccountInvitation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'principal_type', type: 'varchar', length: 10 })
  principalType!: 'staff' | 'customer';

  @Column({ name: 'principal_id', type: 'int' })
  principalId!: number;

  /** The address the link was sent to, as it was when the invitation was issued. Acceptance is refused if the account's e-mail is no longer this. */
  @Column({ type: 'varchar', length: 160 })
  email!: string;

  /** The recipient's name as it was when the invitation was issued, so the list can show it without reading the account. */
  @Column({ name: 'recipient_name', type: 'varchar', length: 200 })
  recipientName!: string;

  @Index('UQ_account_invitations_token_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' })
  status!: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';

  @Column({ name: 'expires_at', type: 'datetime', precision: 6 })
  expiresAt!: Date;

  @Column({ name: 'accepted_at', type: 'datetime', precision: 6, nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'datetime', precision: 6, nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 40, nullable: true })
  cancelReason!: string | null;

  /** When the "Invitation Expired" message was sent (once per expiry). */
  @Column({ name: 'expired_notified_at', type: 'datetime', precision: 6, nullable: true })
  expiredNotifiedAt!: Date | null;

  @Column({ name: 'sent_count', type: 'int', default: 0 })
  sentCount!: number;

  @Column({ name: 'last_sent_at', type: 'datetime', precision: 6, nullable: true })
  lastSentAt!: Date | null;

  /** Why the last delivery failed (SMTP not configured, server refused, …); null after a successful one. Never holds a link or a token. */
  @Column({ name: 'last_send_error', type: 'varchar', length: 400, nullable: true })
  lastSendError!: string | null;

  /** The staff user who issued the invitation; null when the system did (a customer's approval). */
  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
