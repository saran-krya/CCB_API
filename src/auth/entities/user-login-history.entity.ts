import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_login_history')
export class UserLoginHistory {
  @PrimaryGeneratedColumn()
  id!: number;

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
