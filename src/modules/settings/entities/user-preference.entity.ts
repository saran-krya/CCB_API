import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import type { NotificationPreferences } from '../settings.constants';

/**
 * One row per user: the personal preferences that are not already columns on `users` (theme, navigation colour and language
 * stay there — PATCH /users/me/preferences — so the theme provider and i18n keep working unchanged). Every column is
 * nullable and null means "no personal choice — use the system default" (the SYSTEM attributes behind System Settings).
 */
@Entity('user_preferences')
export class UserPreference extends BaseEntity {
  @Index('uq_user_preferences_user', { unique: true })
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'timezone', type: 'varchar', length: 64, nullable: true })
  timezone!: string | null;

  @Column({ name: 'date_format', type: 'varchar', length: 20, nullable: true })
  dateFormat!: string | null;

  /** Retained only so the column — and anything already stored in it — is left untouched. A personal currency is no longer
   *  offered (the currency is the single Default Currency attribute), so nothing reads or writes this any more. */
  @Column({ name: 'currency_code', type: 'varchar', length: 10, nullable: true })
  currencyCode!: string | null;

  @Column({ name: 'sidebar_state', type: 'varchar', length: 12, nullable: true })
  sidebarState!: string | null;

  @Column({ name: 'table_density', type: 'varchar', length: 12, nullable: true })
  tableDensity!: string | null;

  @Column({ name: 'default_page_size', type: 'int', nullable: true })
  defaultPageSize!: number | null;

  /** Only the categories the user has actually changed; a missing category is on for both channels. */
  @Column({ name: 'notification_preferences', type: 'json', nullable: true })
  notificationPreferences!: Partial<NotificationPreferences> | null;
}
