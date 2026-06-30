import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_devices')
@Unique(['userId', 'deviceId'])
export class UserDevice {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Index()
  @Column({ name: 'device_id', type: 'varchar', length: 36 })
  deviceId!: string;

  @Column({ name: 'device_name', type: 'varchar', length: 255, nullable: true })
  deviceName?: string;

  @Column({ name: 'device_type', type: 'varchar', length: 50, nullable: true })
  deviceType?: string;

  @Column({ name: 'browser', type: 'varchar', length: 100, nullable: true })
  browser?: string;

  @Column({ name: 'browser_version', type: 'varchar', length: 50, nullable: true })
  browserVersion?: string;

  @Column({ name: 'operating_system', type: 'varchar', length: 100, nullable: true })
  operatingSystem?: string;

  @Column({ name: 'os_version', type: 'varchar', length: 50, nullable: true })
  osVersion?: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string;

  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 64, nullable: true })
  refreshTokenHash?: string;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt?: Date | null;

  @Column({ name: 'last_activity_at', type: 'timestamp', nullable: true })
  lastActivityAt?: Date | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date | null;

  @Column({ name: 'is_trusted', type: 'boolean', default: false })
  isTrusted!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
