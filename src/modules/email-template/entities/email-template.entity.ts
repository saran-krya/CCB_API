import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * One e-mail template in one language. `key` says what the message is for (a built-in one such as STAFF_INVITATION, or a custom one an
 * administrator created); `(key, locale)` is unique. The subject and the body are kept apart, the body is an HTML fragment sanitised when it
 * is saved, and both may use the supported `{{placeholders}}`. The table is created by migration 1795600000000; keep this entity and that
 * migration identical (TypeORM's schema comparison must stay at 0 pending changes).
 */
@Entity('email_templates')
@Index('UQ_email_templates_key_locale', ['key', 'locale'], { unique: true })
export class EmailTemplate {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'template_key', type: 'varchar', length: 60 })
  key!: string;

  @Column({ type: 'varchar', length: 5 })
  locale!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 300 })
  subject!: string;

  /** MEDIUMTEXT, not TEXT: TEXT holds 65,535 BYTES (about 32,000 Arabic characters in utf8mb4) while a body may be up to EMAIL_TEMPLATE_LIMITS.BODY_MAX
   *  characters, so a long body would fail to save (or, without strict SQL mode, be cut off mid-tag). */
  @Column({ name: 'body_html', type: 'mediumtext' })
  bodyHtml!: string;

  /** The plain-text alternative; null means "make it from the HTML". */
  @Column({ name: 'body_text', type: 'mediumtext', nullable: true })
  bodyText!: string | null;

  /** An inactive template is ignored when a message is sent: the built-in default is used instead. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** True for the templates the invitation system sends (their key and language are fixed). */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
