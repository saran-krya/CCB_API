import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Customer } from './customer.entity';

/**
 * One-time, single-use activation link — mirrors RefreshToken's own opaque-hash-at-rest pattern
 * (see auth/entities/refresh-token.entity.ts): the raw token is emailed to the customer and never
 * persisted anywhere; only its SHA-256 hash is stored, so a database read alone can never yield a
 * usable token. `usedAt` enforces single-use; `expiresAt` enforces the configured expiry window.
 */
@Entity('customer_activation_tokens')
export class CustomerActivationToken {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  customer!: Customer;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamp', nullable: true, default: null })
  usedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
