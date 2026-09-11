import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  /** `userId` alone is NOT globally unique — it's a `users.id` when principalType is 'staff' and a
   *  `customers.id` when 'customer', two entirely independent id spaces that can and do collide
   *  (e.g. staff user 22 and customer 22 are unrelated rows). Every query against this table must
   *  filter on BOTH columns together, never `userId` alone, or a refresh/logout/device-list call
   *  can silently act on the wrong principal's session. Defaults to 'staff' so every pre-existing
   *  row (all created before customer login existed) is correctly backfilled. */
  @Column({ name: 'principal_type', type: 'varchar', length: 10, default: 'staff' })
  principalType!: 'staff' | 'customer';

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Index()
  @Column({ name: 'family', type: 'varchar', length: 36 })
  family!: string;

  @Column({ name: 'device_id', type: 'varchar', length: 36, nullable: true })
  deviceId?: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true, default: null })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
