import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Splits Company/Trade-License/TRN fields out of RegistrationCustomerDetail and Customer into two
 * new sibling tables — registration_company_details (1:1 with registration_requests, present only
 * for Corporate requests) and company (1:1 with customers, present only for Corporate customers) —
 * leaving registration_customer_details/customers holding Owner/Tenant person fields only.
 *
 * DATA-PRESERVING: exactly the same pattern as 1788342228029-RefactorRegistrationRequestSchema —
 * every existing value is copied into the new table BEFORE the old column is dropped, and every
 * step is guarded (CREATE TABLE IF NOT EXISTS equivalent via hasTable, column drops via hasColumn,
 * FK adds via hasFk) so this migration is safe to re-run if it's interrupted partway through.
 *
 * A row is created in the new table ONLY where the source row actually has at least one non-null
 * Company field — an Individual request/customer's customer-detail/customer row never had Company
 * data to begin with, so it correctly gets no registration_company_details/company row at all
 * (row-absence models the 1:1-nullable relationship, not a nullable FK — see both new entities'
 * own doc comments).
 *
 * companyRegistrationNumber/trnExpiryDate are genuinely NEW columns on both new tables — there is
 * no prior source column for either on registration_customer_details, so they migrate as NULL for
 * every pre-existing registration_company_details row; the customers table DID already have both,
 * so those two values ARE carried over onto `company` (not left NULL). trade_license_verified/
 * trn_verified already existed on registration_customer_details and migrate cleanly onto
 * registration_company_details; on the `customers` -> `company` side these two are new columns
 * with no prior source data (Customer never had them), so they migrate as NULL there — a new
 * capability, not a data-loss case, since there was never a stored value to lose.
 */
export class SplitCompanyFromCustomerAndRegistrationDetails1789100000000 implements MigrationInterface {
    name = 'SplitCompanyFromCustomerAndRegistrationDetails1789100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = async (table: string, column: string): Promise<boolean> => {
            const rows = await queryRunner.query(
                `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [table, column],
            );
            return Number(rows[0].cnt) > 0;
        };
        const hasTable = async (table: string): Promise<boolean> => {
            const rows = await queryRunner.query(
                `SELECT COUNT(*) as cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
                [table],
            );
            return Number(rows[0].cnt) > 0;
        };
        // Checked by (table, column) rather than by our own constraint name — a dev database with
        // synchronize:true active (see typeorm.config.ts) may already have created an
        // auto-named FK on this exact column before this migration ever runs (the same risk the
        // precedent 1788342228029 migration's own doc comment warns about). Adding a second,
        // differently-named FK on the same column would be redundant, not harmful, but this check
        // avoids it either way.
        const hasFkOnColumn = async (table: string, column: string): Promise<boolean> => {
            const rows = await queryRunner.query(
                `SELECT COUNT(*) as cnt FROM information_schema.KEY_COLUMN_USAGE
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
                [table, column],
            );
            return Number(rows[0].cnt) > 0;
        };

        // ── 1. Create the two new tables (skip if already present) ──────────────────────────────
        if (!(await hasTable('registration_company_details'))) {
            await queryRunner.query(`CREATE TABLE \`registration_company_details\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`legal_structure\` enum ('LLC', 'Free Zone Company', 'Sole Establishment', 'Branch of Foreign Company') NULL, \`company_registration_date\` date NULL, \`company_registration_number\` varchar(60) NULL, \`trade_license_number\` varchar(60) NULL, \`license_expiry_date\` date NULL, \`manager_name\` varchar(160) NULL, \`trade_license_verified\` tinyint NULL, \`trn\` varchar(20) NULL, \`trn_expiry_date\` date NULL, \`taxable_entity_name\` varchar(160) NULL, \`effective_registration_date\` date NULL, \`issuing_authority\` varchar(120) NULL, \`trn_verified\` tinyint NULL, \`registration_request_id\` int NOT NULL, UNIQUE INDEX \`REL_reg_company_detail_request\` (\`registration_request_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }
        if (!(await hasTable('company'))) {
            await queryRunner.query(`CREATE TABLE \`company\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`legal_structure\` enum ('LLC', 'Free Zone Company', 'Sole Establishment', 'Branch of Foreign Company') NULL, \`company_registration_date\` date NULL, \`company_registration_number\` varchar(60) NULL, \`trade_license_number\` varchar(60) NULL, \`license_expiry_date\` date NULL, \`manager_name\` varchar(160) NULL, \`trade_license_verified\` tinyint NULL, \`trn\` varchar(20) NULL, \`trn_expiry_date\` date NULL, \`taxable_entity_name\` varchar(160) NULL, \`effective_registration_date\` date NULL, \`issuing_authority\` varchar(120) NULL, \`trn_verified\` tinyint NULL, \`customer_id\` int NOT NULL, UNIQUE INDEX \`REL_company_customer\` (\`customer_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }

        // ── 2. Copy existing Company data from registration_customer_details, ONLY if the old
        //       columns still exist there (a fresh/already-migrated DB won't have them) ──────────
        if (await hasColumn('registration_customer_details', 'trade_license_number')) {
            await queryRunner.query(`
              INSERT INTO registration_company_details
                (registration_request_id, legal_structure, company_registration_date, trade_license_number,
                 license_expiry_date, manager_name, trade_license_verified, trn, taxable_entity_name,
                 effective_registration_date, issuing_authority, trn_verified, created_at, updated_at)
              SELECT
                cd.registration_request_id, cd.legal_structure, cd.company_registration_date, cd.trade_license_number,
                cd.license_expiry_date, cd.manager_name, cd.trade_license_verified, cd.trn, cd.taxable_entity_name,
                cd.effective_registration_date, cd.issuing_authority, cd.trn_verified, NOW(6), NOW(6)
              FROM registration_customer_details cd
              WHERE NOT EXISTS (SELECT 1 FROM registration_company_details rcd WHERE rcd.registration_request_id = cd.registration_request_id)
                AND (
                  cd.legal_structure IS NOT NULL OR cd.company_registration_date IS NOT NULL
                  OR cd.trade_license_number IS NOT NULL OR cd.license_expiry_date IS NOT NULL
                  OR cd.manager_name IS NOT NULL OR cd.trade_license_verified IS NOT NULL
                  OR cd.trn IS NOT NULL OR cd.taxable_entity_name IS NOT NULL
                  OR cd.effective_registration_date IS NOT NULL OR cd.issuing_authority IS NOT NULL
                  OR cd.trn_verified IS NOT NULL
                )
            `);

            // ── 3. Only now drop the old Company columns from registration_customer_details ──────
            const oldRegistrationCompanyColumns = [
                'legal_structure', 'company_registration_date', 'trade_license_number', 'trn',
                'license_expiry_date', 'manager_name', 'taxable_entity_name', 'effective_registration_date',
                'issuing_authority', 'trade_license_verified', 'trn_verified',
            ];
            for (const col of oldRegistrationCompanyColumns) {
                if (await hasColumn('registration_customer_details', col)) {
                    await queryRunner.query(`ALTER TABLE \`registration_customer_details\` DROP COLUMN \`${col}\``);
                }
            }
        }

        // ── 4. Copy existing Company data from customers, ONLY if the old columns still exist ───
        if (await hasColumn('customers', 'trade_license_number')) {
            await queryRunner.query(`
              INSERT INTO company
                (customer_id, legal_structure, company_registration_date, company_registration_number,
                 trade_license_number, license_expiry_date, manager_name, trn, trn_expiry_date,
                 taxable_entity_name, effective_registration_date, issuing_authority, created_at, updated_at)
              SELECT
                c.id, c.legal_structure, c.company_registration_date, c.company_registration_number,
                c.trade_license_number, c.license_expiry_date, c.manager_name, c.trn, c.trn_expiry_date,
                c.taxable_entity_name, c.effective_registration_date, c.issuing_authority, NOW(6), NOW(6)
              FROM customers c
              WHERE NOT EXISTS (SELECT 1 FROM company co WHERE co.customer_id = c.id)
                AND (
                  c.legal_structure IS NOT NULL OR c.company_registration_date IS NOT NULL
                  OR c.company_registration_number IS NOT NULL OR c.trade_license_number IS NOT NULL
                  OR c.license_expiry_date IS NOT NULL OR c.manager_name IS NOT NULL
                  OR c.trn IS NOT NULL OR c.trn_expiry_date IS NOT NULL OR c.taxable_entity_name IS NOT NULL
                  OR c.effective_registration_date IS NOT NULL OR c.issuing_authority IS NOT NULL
                )
            `);
            // trade_license_verified/trn_verified are NOT copied here — customers never had these
            // columns, so every migrated `company` row correctly gets NULL for both (no prior value
            // existed to preserve; this is a new capability, not a data-loss case).

            // ── 5. Only now drop the old Company columns from customers ──────────────────────────
            const oldCustomerCompanyColumns = [
                'legal_structure', 'company_registration_date', 'company_registration_number',
                'trade_license_number', 'license_expiry_date', 'trn', 'trn_expiry_date',
                'manager_name', 'taxable_entity_name', 'effective_registration_date', 'issuing_authority',
            ];
            for (const col of oldCustomerCompanyColumns) {
                if (await hasColumn('customers', col)) {
                    await queryRunner.query(`ALTER TABLE \`customers\` DROP COLUMN \`${col}\``);
                }
            }
        }

        // ── 6. FKs from the new tables, if not already present (by column, not by name — see
        //       hasFkOnColumn's own comment above) ───────────────────────────────────────────────
        if (!(await hasFkOnColumn('registration_company_details', 'registration_request_id'))) {
            await queryRunner.query(`ALTER TABLE \`registration_company_details\` ADD CONSTRAINT \`FK_reg_company_detail_request\` FOREIGN KEY (\`registration_request_id\`) REFERENCES \`registration_requests\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        }
        if (!(await hasFkOnColumn('company', 'customer_id'))) {
            await queryRunner.query(`ALTER TABLE \`company\` ADD CONSTRAINT \`FK_company_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Re-adds the old columns and copies data back from the new tables, then drops the new
        // tables — the inverse of up(). companyRegistrationNumber/trnExpiryDate are dropped
        // entirely on the registration_customer_details side (they never existed there before this
        // migration) and trade_license_verified/trn_verified are dropped entirely on the customers
        // side (same reason), matching exactly what up() added net-new.
        await queryRunner.query(`ALTER TABLE \`company\` DROP FOREIGN KEY \`FK_company_customer\``);
        await queryRunner.query(`ALTER TABLE \`registration_company_details\` DROP FOREIGN KEY \`FK_reg_company_detail_request\``);

        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`issuing_authority\` varchar(120) NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`effective_registration_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`taxable_entity_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`manager_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`trn_expiry_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`trn\` varchar(20) NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`license_expiry_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`trade_license_number\` varchar(60) NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`company_registration_number\` varchar(60) NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`company_registration_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`legal_structure\` enum ('LLC', 'Free Zone Company', 'Sole Establishment', 'Branch of Foreign Company') NULL`);

        await queryRunner.query(`
          UPDATE customers c
          JOIN company co ON co.customer_id = c.id
          SET c.legal_structure = co.legal_structure, c.company_registration_date = co.company_registration_date,
              c.company_registration_number = co.company_registration_number, c.trade_license_number = co.trade_license_number,
              c.license_expiry_date = co.license_expiry_date, c.trn = co.trn, c.trn_expiry_date = co.trn_expiry_date,
              c.manager_name = co.manager_name, c.taxable_entity_name = co.taxable_entity_name,
              c.effective_registration_date = co.effective_registration_date, c.issuing_authority = co.issuing_authority
        `);

        await queryRunner.query(`DROP TABLE \`company\``);

        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`trn_verified\` tinyint NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`trade_license_verified\` tinyint NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`issuing_authority\` varchar(120) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`effective_registration_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`taxable_entity_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`manager_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`license_expiry_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`trn\` varchar(20) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`trade_license_number\` varchar(60) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`company_registration_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD \`legal_structure\` enum ('LLC', 'Free Zone Company', 'Sole Establishment', 'Branch of Foreign Company') NULL`);

        await queryRunner.query(`
          UPDATE registration_customer_details cd
          JOIN registration_company_details rcd ON rcd.registration_request_id = cd.registration_request_id
          SET cd.legal_structure = rcd.legal_structure, cd.company_registration_date = rcd.company_registration_date,
              cd.trade_license_number = rcd.trade_license_number, cd.trn = rcd.trn,
              cd.license_expiry_date = rcd.license_expiry_date, cd.manager_name = rcd.manager_name,
              cd.taxable_entity_name = rcd.taxable_entity_name, cd.effective_registration_date = rcd.effective_registration_date,
              cd.issuing_authority = rcd.issuing_authority, cd.trade_license_verified = rcd.trade_license_verified,
              cd.trn_verified = rcd.trn_verified
        `);

        await queryRunner.query(`DROP TABLE \`registration_company_details\``);
    }

}
