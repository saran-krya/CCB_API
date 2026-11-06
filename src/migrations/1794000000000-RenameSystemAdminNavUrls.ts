import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * System Admin's pages moved from `/admin/system/...` to `/system-admin/...` (the web app's route folder was renamed and
 * bootstrap/seed-data.ts now seeds the new paths). The seeder is find-or-create by `code`, so it never rewrites a row
 * that already exists — without this migration an established database keeps serving `/admin/system/...` from
 * GET /auth/me/nav-catalog and the sidebar links to pages that no longer exist.
 *
 * DATA ONLY: no table, column or index is touched. It rewrites the leading `/admin/system` of a stored `url` to
 * `/system-admin` in the three navigation tables (modules, sub_modules, screens), and only where a url starts with
 * exactly that prefix. Idempotent — a second run finds nothing to change — and a database with no navigation tables yet
 * (cold start, before the baseline migration builds them) or no matching rows is left untouched.
 *
 * down() puts the old prefix back on exactly the rows that carry the new one.
 */
const OLD_PREFIX = '/admin/system';
const NEW_PREFIX = '/system-admin';
const NAV_TABLES = ['modules', 'sub_modules', 'screens'] as const;

async function hasUrlColumn(queryRunner: QueryRunner, table: string): Promise<boolean> {
    const dbName = queryRunner.connection.options.database as string;
    const rows = await queryRunner.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'url'`,
        [dbName, table],
    );
    return rows.length > 0;
}

async function renamePrefix(queryRunner: QueryRunner, from: string, to: string): Promise<void> {
    for (const table of NAV_TABLES) {
        if (!(await hasUrlColumn(queryRunner, table))) continue;
        // `from` itself, or `from` followed by a path segment — never a sibling such as `/admin/system-foo`.
        await queryRunner.query(
            `UPDATE \`${table}\` SET url = CONCAT(?, SUBSTRING(url, ?)) WHERE url = ? OR url LIKE ?`,
            [to, from.length + 1, from, `${from}/%`],
        );
    }
}

export class RenameSystemAdminNavUrls1794000000000 implements MigrationInterface {
    name = 'RenameSystemAdminNavUrls1794000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await renamePrefix(queryRunner, OLD_PREFIX, NEW_PREFIX);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await renamePrefix(queryRunner, NEW_PREFIX, OLD_PREFIX);
    }
}
