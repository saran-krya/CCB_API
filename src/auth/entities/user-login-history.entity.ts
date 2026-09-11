import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_login_history')
export class UserLoginHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  /** See RefreshToken.principalType's own doc comment — `userId` alone collides across the two
   *  independent id spaces (users.id vs customers.id), so every query here must filter on both
   *  columns together. Defaults to 'staff' to backfill every pre-existing row correctly. */
  @Column({ name: 'principal_type', type: 'varchar', length: 10, default: 'staff' })
  principalType!: 'staff' | 'customer';

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'device_id', type: 'varchar', length: 36, nullable: true })
  deviceId?: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string | null;

  @Column({ name: 'browser', type: 'varchar', length: 100, nullable: true })
  browser?: string | null;

  @Column({ name: 'platform', type: 'varchar', length: 100, nullable: true })
  platform?: string | null;

  @CreateDateColumn({ name: 'login_at' })
  loginAt!: Date;

  @Column({ name: 'logout_at', type: 'timestamp', nullable: true })
  logoutAt?: Date | null;
}
