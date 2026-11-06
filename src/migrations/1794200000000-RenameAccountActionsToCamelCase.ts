import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The 15 Account actions (Personal Settings and Security) get AWS-style, camel-case names — ViewProfile, UpdateProfile,
 * RevokeActiveSessions … — so the Policy editor lists them the way the AWS console lists an action (GetAccountInformation).
 * Only `actions.name` changes: the CODES are untouched (policy statements store codes), so no grant, statement or role is affected.
 *
 * bootstrap/seed-data.ts seeds the same names, but its find-or-create never rewrites a row that already exists, so an established
 * database needs this. Idempotent (a row that already carries the new name is left alone) and safe against the unique index on
 * `actions.name` (a name another action already holds is skipped, never forced). A database without the table or rows (fresh install,
 * before the seed) changes nothing. down() puts the previous names back.
 */
const RENAMES: { code: string; from: string; to: string }[] = [
  { code: 'SETTINGS_PROFILE_VIEW', from: 'View My Profile', to: 'ViewProfile' },
  { code: 'SETTINGS_PROFILE_UPDATE', from: 'Update My Profile', to: 'UpdateProfile' },
  { code: 'SETTINGS_APPEARANCE_VIEW', from: 'View Appearance Settings', to: 'ViewAppearance' },
  { code: 'SETTINGS_APPEARANCE_UPDATE', from: 'Update Appearance Settings', to: 'UpdateAppearance' },
  { code: 'SETTINGS_REGIONAL_VIEW', from: 'View Regional Preferences', to: 'ViewRegionalPreferences' },
  { code: 'SETTINGS_REGIONAL_UPDATE', from: 'Update Regional Preferences', to: 'UpdateRegionalPreferences' },
  { code: 'SETTINGS_DISPLAY_VIEW', from: 'View Display Preferences', to: 'ViewDisplayPreferences' },
  { code: 'SETTINGS_DISPLAY_UPDATE', from: 'Update Display Preferences', to: 'UpdateDisplayPreferences' },
  { code: 'SETTINGS_NOTIFICATIONS_VIEW', from: 'View Notification Preferences', to: 'ViewNotifications' },
  { code: 'SETTINGS_NOTIFICATIONS_UPDATE', from: 'Update Notification Preferences', to: 'UpdateNotifications' },
  { code: 'SETTINGS_PASSWORD_VIEW', from: 'View Password Settings', to: 'ViewPasswordSettings' },
  { code: 'SETTINGS_PASSWORD_UPDATE', from: 'Change Own Password', to: 'ChangePassword' },
  { code: 'SETTINGS_SESSIONS_VIEW', from: 'View Active Sessions', to: 'ViewActiveSessions' },
  { code: 'SETTINGS_SESSIONS_UPDATE', from: 'Revoke Active Sessions', to: 'RevokeActiveSessions' },
  { code: 'SETTINGS_LOGIN_HISTORY_VIEW', from: 'View Login History', to: 'ViewLoginHistory' },
];

async function renameActions(queryRunner: QueryRunner, direction: 'forward' | 'back'): Promise<void> {
  if (!(await queryRunner.hasTable('actions'))) return;
  for (const { code, from, to } of RENAMES) {
    const target = direction === 'forward' ? to : from;
    const [row] = await queryRunner.query(`SELECT id, name FROM actions WHERE code = ? LIMIT 1`, [code]);
    if (!row || row.name === target) continue;
    const [taken] = await queryRunner.query(`SELECT id FROM actions WHERE name = ? AND id <> ? LIMIT 1`, [target, row.id]);
    if (taken) continue;
    await queryRunner.query(`UPDATE actions SET name = ? WHERE id = ?`, [target, row.id]);
  }
}

export class RenameAccountActionsToCamelCase1794200000000 implements MigrationInterface {
  name = 'RenameAccountActionsToCamelCase1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await renameActions(queryRunner, 'forward');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await renameActions(queryRunner, 'back');
  }
}
