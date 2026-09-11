import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Splits RegistrationRequest's person/contact/corporate/units/billing/payment/deposit fields out
 * into their own tables (registration_customer_details, registration_request_units,
 * registration_request_property_billing, registration_payment_methods, registration_deposits),
 * leaving registration_requests as the application/workflow-state table only.
 *
 * DATA-PRESERVING: unlike a plain auto-generated diff (which would just DROP the old columns), this
 * migration explicitly copies existing data into the new tables BEFORE dropping anything. Written
 * by hand against the exact live schema this project's dev database had at the time this migration
 * was authored (captured via SHOW CREATE TABLE / a hand-verified column-position mapping recovered
 * from binlog row images, after this same schema change was accidentally auto-applied by
 * synchronize:true in dev with no data migration — see auth-context.tsx sibling session notes).
 * Idempotent against re-running on a database that already has the new tables: every INSERT/UPDATE
 * below is guarded by NOT EXISTS / IF checks so this can run safely even if run twice.
 */
export class RefactorRegistrationRequestSchema1788342228029 implements MigrationInterface {
    name = 'RefactorRegistrationRequestSchema1788342228029'

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

        // ── 1. Create the five new tables (skip if this DB already has them — e.g. this exact dev
        //       database, where synchronize:true created them before this migration was written) ──
        if (!(await hasTable('registration_customer_details'))) {
            await queryRunner.query(`CREATE TABLE \`registration_customer_details\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`salutation\` varchar(20) NULL, \`first_name\` varchar(80) NULL, \`middle_name\` varchar(80) NULL, \`last_name\` varchar(80) NULL, \`occupation\` varchar(120) NULL, \`alternate_phone\` varchar(30) NULL, \`gender\` varchar(20) NULL, \`date_of_birth\` date NULL, \`nationality\` varchar(80) NULL, \`marital_status\` varchar(30) NULL, \`principal_name\` varchar(160) NULL, \`principal_email\` varchar(160) NULL, \`principal_phone\` varchar(30) NULL, \`principal_is_primary_recipient\` tinyint NULL, \`contact_person_name\` varchar(160) NULL, \`contact_type\` enum ('Self', 'Authorized Representative', 'Manager on License') NULL, \`email\` varchar(160) NULL, \`mobile\` varchar(30) NULL, \`emergency_contact_name\` varchar(160) NULL, \`emergency_contact_phone\` varchar(30) NULL, \`emergency_contact_relationship\` varchar(40) NULL, \`preferred_language\` varchar(20) NOT NULL DEFAULT 'English', \`preferred_communication_channel\` varchar(20) NOT NULL DEFAULT 'Email', \`photo_url\` text NULL, \`legal_structure\` enum ('LLC', 'Free Zone Company', 'Sole Establishment', 'Branch of Foreign Company') NULL, \`company_registration_date\` date NULL, \`trade_license_number\` varchar(60) NULL, \`trn\` varchar(20) NULL, \`license_expiry_date\` date NULL, \`manager_name\` varchar(160) NULL, \`taxable_entity_name\` varchar(160) NULL, \`effective_registration_date\` date NULL, \`issuing_authority\` varchar(120) NULL, \`trade_license_verified\` tinyint NULL, \`trn_verified\` tinyint NULL, \`property_document_type\` varchar(60) NULL, \`property_document_reference\` varchar(120) NULL, \`registration_request_id\` int NOT NULL, UNIQUE INDEX \`REL_3f28b1d5ac6df45bfeff4ff04f\` (\`registration_request_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }
        if (!(await hasTable('registration_request_units'))) {
            await queryRunner.query(`CREATE TABLE \`registration_request_units\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`unit_id\` int NOT NULL, \`property_id\` int NOT NULL, \`community_id\` int NOT NULL, \`request_id\` int NOT NULL, INDEX \`IDX_665a296f66e44faf395433b770\` (\`unit_id\`), UNIQUE INDEX \`IDX_8a324ab99f1c42a2d3fdcb1415\` (\`request_id\`, \`unit_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }
        if (!(await hasTable('registration_request_property_billing'))) {
            await queryRunner.query(`CREATE TABLE \`registration_request_property_billing\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`property_id\` int NOT NULL, \`billing_type\` varchar(40) NOT NULL, \`request_id\` int NOT NULL, UNIQUE INDEX \`IDX_bfb536638f2594cd8eaa81ea75\` (\`request_id\`, \`property_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }
        if (!(await hasTable('registration_payment_methods'))) {
            await queryRunner.query(`CREATE TABLE \`registration_payment_methods\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`type\` varchar(40) NOT NULL, \`masked_identifier\` varchar(40) NOT NULL, \`brand_or_bank\` varchar(80) NULL, \`expiry\` varchar(10) NULL, \`account_holder_name\` varchar(160) NULL, \`bank_name\` varchar(160) NULL, \`is_default\` tinyint NOT NULL DEFAULT 0, \`request_id\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }
        if (!(await hasTable('registration_deposits'))) {
            await queryRunner.query(`CREATE TABLE \`registration_deposits\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`amount\` decimal(12,2) NOT NULL DEFAULT '0.00', \`status\` enum ('Pending', 'Paid') NOT NULL DEFAULT 'Pending', \`payment_method\` varchar(40) NULL, \`payment_reference\` varchar(80) NULL, \`paid_at\` datetime NULL, \`request_id\` int NOT NULL, UNIQUE INDEX \`REL_f70d6a201531bc1c89d9d767ed\` (\`request_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }

        // ── 2. Migrate existing data from registration_requests' old columns, ONLY if those old
        //       columns still exist on this database (a fresh/already-migrated DB won't have them) ──
        const hasOldColumns = await hasColumn('registration_requests', 'first_name');
        if (hasOldColumns) {
            // registration_customer_details — one row per request that has ANY person/contact/
            // corporate field set (skips requests where every one of these was NULL, matching what
            // upsertCustomerDetails would produce going forward: no row until something is saved).
            await queryRunner.query(`
              INSERT INTO registration_customer_details
                (registration_request_id, salutation, first_name, middle_name, last_name, occupation,
                 alternate_phone, gender, date_of_birth, nationality, marital_status,
                 principal_name, principal_email, principal_phone, principal_is_primary_recipient,
                 contact_person_name, contact_type, email, mobile,
                 emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
                 preferred_language, preferred_communication_channel, photo_url,
                 legal_structure, company_registration_date, trade_license_number, trn, license_expiry_date,
                 manager_name, taxable_entity_name, effective_registration_date, issuing_authority,
                 trade_license_verified, trn_verified, property_document_type, property_document_reference,
                 created_at, updated_at)
              SELECT
                r.id, r.salutation, r.first_name, r.middle_name, r.last_name, r.occupation,
                r.alternate_phone, r.gender, r.date_of_birth, r.nationality, r.marital_status,
                r.principal_name, r.principal_email, r.principal_phone, r.principal_is_primary_recipient,
                r.contact_person_name, r.contact_type, r.email, r.mobile,
                r.emergency_contact_name, r.emergency_contact_phone, r.emergency_contact_relationship,
                COALESCE(r.preferred_language, 'English'), COALESCE(r.preferred_communication_channel, 'Email'), r.photo_url,
                r.legal_structure, r.company_registration_date, r.trade_license_number, r.trn, r.license_expiry_date,
                r.manager_name, r.taxable_entity_name, r.effective_registration_date, r.issuing_authority,
                r.trade_license_verified, r.trn_verified, r.property_document_type, r.property_document_reference,
                NOW(6), NOW(6)
              FROM registration_requests r
              WHERE NOT EXISTS (SELECT 1 FROM registration_customer_details cd WHERE cd.registration_request_id = r.id)
                AND (
                  r.salutation IS NOT NULL OR r.first_name IS NOT NULL OR r.middle_name IS NOT NULL OR r.last_name IS NOT NULL
                  OR r.occupation IS NOT NULL OR r.alternate_phone IS NOT NULL OR r.gender IS NOT NULL OR r.date_of_birth IS NOT NULL
                  OR r.nationality IS NOT NULL OR r.marital_status IS NOT NULL OR r.principal_name IS NOT NULL
                  OR r.principal_email IS NOT NULL OR r.principal_phone IS NOT NULL OR r.principal_is_primary_recipient IS NOT NULL
                  OR r.contact_person_name IS NOT NULL OR r.contact_type IS NOT NULL OR r.email IS NOT NULL OR r.mobile IS NOT NULL
                  OR r.emergency_contact_name IS NOT NULL OR r.emergency_contact_phone IS NOT NULL OR r.emergency_contact_relationship IS NOT NULL
                  OR r.photo_url IS NOT NULL OR r.legal_structure IS NOT NULL OR r.company_registration_date IS NOT NULL
                  OR r.trade_license_number IS NOT NULL OR r.trn IS NOT NULL OR r.license_expiry_date IS NOT NULL
                  OR r.manager_name IS NOT NULL OR r.taxable_entity_name IS NOT NULL OR r.effective_registration_date IS NOT NULL
                  OR r.issuing_authority IS NOT NULL OR r.trade_license_verified IS NOT NULL OR r.trn_verified IS NOT NULL
                  OR r.property_document_type IS NOT NULL OR r.property_document_reference IS NOT NULL
                )
            `);

            // registration_request_units — selected_units was a JSON array; MySQL 8's JSON_TABLE
            // expands it into rows.
            await queryRunner.query(`
              INSERT INTO registration_request_units (request_id, unit_id, property_id, community_id, created_at, updated_at)
              SELECT r.id, jt.unitId, jt.propertyId, jt.communityId, NOW(6), NOW(6)
              FROM registration_requests r,
                JSON_TABLE(
                  COALESCE(NULLIF(r.selected_units, ''), '[]'),
                  '$[*]' COLUMNS (
                    unitId INT PATH '$.unitId',
                    propertyId INT PATH '$.propertyId',
                    communityId INT PATH '$.communityId'
                  )
                ) AS jt
              WHERE NOT EXISTS (SELECT 1 FROM registration_request_units u WHERE u.request_id = r.id)
            `);

            // registration_request_property_billing — same JSON-array expansion.
            await queryRunner.query(`
              INSERT INTO registration_request_property_billing (request_id, property_id, billing_type, created_at, updated_at)
              SELECT r.id, jt.propertyId, jt.billingType, NOW(6), NOW(6)
              FROM registration_requests r,
                JSON_TABLE(
                  COALESCE(NULLIF(r.property_billing, ''), '[]'),
                  '$[*]' COLUMNS (
                    propertyId INT PATH '$.propertyId',
                    billingType VARCHAR(40) PATH '$.billingType'
                  )
                ) AS jt
              WHERE NOT EXISTS (SELECT 1 FROM registration_request_property_billing b WHERE b.request_id = r.id)
            `);

            // registration_payment_methods — same JSON-array expansion; the old client-generated
            // string id (e.g. "pm-1788266275670") is intentionally dropped, matching
            // RegistrationRequestService.syncChildCollections' own handling of new saves.
            await queryRunner.query(`
              INSERT INTO registration_payment_methods
                (request_id, type, masked_identifier, brand_or_bank, expiry, account_holder_name, bank_name, is_default, created_at, updated_at)
              SELECT r.id, jt.type, COALESCE(jt.maskedIdentifier, ''), jt.brandOrBank, jt.expiry, jt.accountHolderName, jt.bankName, COALESCE(jt.isDefault, 0), NOW(6), NOW(6)
              FROM registration_requests r,
                JSON_TABLE(
                  COALESCE(NULLIF(r.payment_methods, ''), '[]'),
                  '$[*]' COLUMNS (
                    type VARCHAR(40) PATH '$.type',
                    maskedIdentifier VARCHAR(40) PATH '$.maskedIdentifier',
                    brandOrBank VARCHAR(80) PATH '$.brandOrBank',
                    expiry VARCHAR(10) PATH '$.expiry',
                    accountHolderName VARCHAR(160) PATH '$.accountHolderName',
                    bankName VARCHAR(160) PATH '$.bankName',
                    isDefault TINYINT(1) PATH '$.isDefault'
                  )
                ) AS jt
              WHERE NOT EXISTS (SELECT 1 FROM registration_payment_methods m WHERE m.request_id = r.id)
            `);

            // registration_deposits — only for requests where a deposit was actually raised/paid
            // (amount > 0 or status = 'Paid'); a Pending/zero-amount row is equivalent to no row,
            // matching RegistrationRequestService.upsertDeposit's own lazy-create behavior.
            await queryRunner.query(`
              INSERT INTO registration_deposits (request_id, amount, status, payment_method, payment_reference, paid_at, created_at, updated_at)
              SELECT r.id, r.security_deposit_amount, r.deposit_payment_status, r.deposit_payment_method, r.deposit_payment_reference, r.deposit_paid_date, NOW(6), NOW(6)
              FROM registration_requests r
              WHERE NOT EXISTS (SELECT 1 FROM registration_deposits d WHERE d.request_id = r.id)
                AND (r.security_deposit_amount > 0 OR r.deposit_payment_status = 'Paid')
            `);

            // ── 3. Only now drop the old columns — data has already been copied above. ──
            const oldColumns = [
                'salutation', 'first_name', 'middle_name', 'last_name', 'occupation', 'alternate_phone',
                'principal_name', 'principal_email', 'principal_phone', 'principal_is_primary_recipient',
                'property_document_type', 'property_document_reference', 'contact_person_name', 'contact_type',
                'gender', 'date_of_birth', 'nationality', 'marital_status',
                'legal_structure', 'company_registration_date', 'trade_license_number', 'trn', 'license_expiry_date',
                'manager_name', 'taxable_entity_name', 'effective_registration_date', 'issuing_authority',
                'trade_license_verified', 'trn_verified',
                'email', 'mobile', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
                'preferred_language', 'preferred_communication_channel', 'photo_url',
                'selected_units', 'property_billing',
                'security_deposit_amount', 'deposit_payment_status', 'deposit_payment_method', 'deposit_payment_reference', 'deposit_paid_date',
                'payment_methods',
            ];
            for (const col of oldColumns) {
                if (await hasColumn('registration_requests', col)) {
                    await queryRunner.query(`ALTER TABLE \`registration_requests\` DROP COLUMN \`${col}\``);
                }
            }
        }

        // ── 4. FKs from the new tables to registration_requests, if not already present. ──
        const hasFk = async (constraintName: string): Promise<boolean> => {
            const rows = await queryRunner.query(
                `SELECT COUNT(*) as cnt FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?`,
                [constraintName],
            );
            return Number(rows[0].cnt) > 0;
        };
        if (!(await hasFk('FK_3f28b1d5ac6df45bfeff4ff04f5'))) {
            await queryRunner.query(`ALTER TABLE \`registration_customer_details\` ADD CONSTRAINT \`FK_3f28b1d5ac6df45bfeff4ff04f5\` FOREIGN KEY (\`registration_request_id\`) REFERENCES \`registration_requests\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        }
        if (!(await hasFk('FK_9d820b11d1986fc1953ccfe2e34'))) {
            await queryRunner.query(`ALTER TABLE \`registration_request_units\` ADD CONSTRAINT \`FK_9d820b11d1986fc1953ccfe2e34\` FOREIGN KEY (\`request_id\`) REFERENCES \`registration_requests\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        }
        if (!(await hasFk('FK_3700b725946caebe92651d2c1a4'))) {
            await queryRunner.query(`ALTER TABLE \`registration_request_property_billing\` ADD CONSTRAINT \`FK_3700b725946caebe92651d2c1a4\` FOREIGN KEY (\`request_id\`) REFERENCES \`registration_requests\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        }
        if (!(await hasFk('FK_2bd09b79343f84c96dd332987b7'))) {
            await queryRunner.query(`ALTER TABLE \`registration_payment_methods\` ADD CONSTRAINT \`FK_2bd09b79343f84c96dd332987b7\` FOREIGN KEY (\`request_id\`) REFERENCES \`registration_requests\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        }
        if (!(await hasFk('FK_f70d6a201531bc1c89d9d767ed5'))) {
            await queryRunner.query(`ALTER TABLE \`registration_deposits\` ADD CONSTRAINT \`FK_f70d6a201531bc1c89d9d767ed5\` FOREIGN KEY (\`request_id\`) REFERENCES \`registration_requests\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Re-adds the old columns and copies data back from the new tables, then drops the new
        // tables — the inverse of up(). Multi-valued children (units/billing/payment methods) are
        // re-serialized to JSON via MySQL 8's JSON_ARRAYAGG/JSON_OBJECT.
        await queryRunner.query(`ALTER TABLE \`registration_request_units\` DROP FOREIGN KEY \`FK_9d820b11d1986fc1953ccfe2e34\``);
        await queryRunner.query(`ALTER TABLE \`registration_deposits\` DROP FOREIGN KEY \`FK_f70d6a201531bc1c89d9d767ed5\``);
        await queryRunner.query(`ALTER TABLE \`registration_payment_methods\` DROP FOREIGN KEY \`FK_2bd09b79343f84c96dd332987b7\``);
        await queryRunner.query(`ALTER TABLE \`registration_request_property_billing\` DROP FOREIGN KEY \`FK_3700b725946caebe92651d2c1a4\``);
        await queryRunner.query(`ALTER TABLE \`registration_customer_details\` DROP FOREIGN KEY \`FK_3f28b1d5ac6df45bfeff4ff04f5\``);

        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`payment_methods\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`deposit_paid_date\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`deposit_payment_reference\` varchar(80) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`deposit_payment_method\` varchar(40) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`deposit_payment_status\` enum ('Pending', 'Paid') NOT NULL DEFAULT 'Pending'`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`security_deposit_amount\` decimal(12,2) NOT NULL DEFAULT '0.00'`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`selected_units\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`property_billing\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`photo_url\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`preferred_communication_channel\` varchar(20) NOT NULL DEFAULT 'Email'`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`preferred_language\` varchar(20) NOT NULL DEFAULT 'English'`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`emergency_contact_relationship\` varchar(40) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`emergency_contact_phone\` varchar(30) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`emergency_contact_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`mobile\` varchar(30) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`email\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`trn_verified\` tinyint NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`trade_license_verified\` tinyint NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`issuing_authority\` varchar(120) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`effective_registration_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`taxable_entity_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`manager_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`license_expiry_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`trn\` varchar(20) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`trade_license_number\` varchar(60) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`company_registration_date\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`legal_structure\` enum ('LLC', 'Free Zone Company', 'Sole Establishment', 'Branch of Foreign Company') NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`marital_status\` varchar(30) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`nationality\` varchar(80) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`date_of_birth\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`gender\` varchar(20) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`contact_type\` enum ('Self', 'Authorized Representative', 'Manager on License') NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`contact_person_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`property_document_reference\` varchar(120) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`property_document_type\` varchar(60) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`principal_is_primary_recipient\` tinyint NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`principal_phone\` varchar(30) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`principal_email\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`principal_name\` varchar(160) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`alternate_phone\` varchar(30) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`occupation\` varchar(120) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`last_name\` varchar(80) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`middle_name\` varchar(80) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`first_name\` varchar(80) NULL`);
        await queryRunner.query(`ALTER TABLE \`registration_requests\` ADD \`salutation\` varchar(20) NULL`);

        await queryRunner.query(`
          UPDATE registration_requests r
          JOIN registration_customer_details cd ON cd.registration_request_id = r.id
          SET r.salutation = cd.salutation, r.first_name = cd.first_name, r.middle_name = cd.middle_name,
              r.last_name = cd.last_name, r.occupation = cd.occupation, r.alternate_phone = cd.alternate_phone,
              r.gender = cd.gender, r.date_of_birth = cd.date_of_birth, r.nationality = cd.nationality,
              r.marital_status = cd.marital_status, r.principal_name = cd.principal_name,
              r.principal_email = cd.principal_email, r.principal_phone = cd.principal_phone,
              r.principal_is_primary_recipient = cd.principal_is_primary_recipient,
              r.contact_person_name = cd.contact_person_name, r.contact_type = cd.contact_type,
              r.email = cd.email, r.mobile = cd.mobile,
              r.emergency_contact_name = cd.emergency_contact_name, r.emergency_contact_phone = cd.emergency_contact_phone,
              r.emergency_contact_relationship = cd.emergency_contact_relationship,
              r.preferred_language = cd.preferred_language, r.preferred_communication_channel = cd.preferred_communication_channel,
              r.photo_url = cd.photo_url, r.legal_structure = cd.legal_structure,
              r.company_registration_date = cd.company_registration_date, r.trade_license_number = cd.trade_license_number,
              r.trn = cd.trn, r.license_expiry_date = cd.license_expiry_date, r.manager_name = cd.manager_name,
              r.taxable_entity_name = cd.taxable_entity_name, r.effective_registration_date = cd.effective_registration_date,
              r.issuing_authority = cd.issuing_authority, r.trade_license_verified = cd.trade_license_verified,
              r.trn_verified = cd.trn_verified, r.property_document_type = cd.property_document_type,
              r.property_document_reference = cd.property_document_reference
        `);

        await queryRunner.query(`
          UPDATE registration_requests r
          LEFT JOIN (
            SELECT request_id, JSON_ARRAYAGG(JSON_OBJECT('unitId', unit_id, 'propertyId', property_id, 'communityId', community_id)) AS units
            FROM registration_request_units GROUP BY request_id
          ) u ON u.request_id = r.id
          SET r.selected_units = COALESCE(u.units, '[]')
        `);

        await queryRunner.query(`
          UPDATE registration_requests r
          LEFT JOIN (
            SELECT request_id, JSON_ARRAYAGG(JSON_OBJECT('propertyId', property_id, 'billingType', billing_type)) AS billing
            FROM registration_request_property_billing GROUP BY request_id
          ) b ON b.request_id = r.id
          SET r.property_billing = b.billing
        `);

        await queryRunner.query(`
          UPDATE registration_requests r
          LEFT JOIN (
            SELECT request_id, JSON_ARRAYAGG(JSON_OBJECT(
              'type', type, 'maskedIdentifier', masked_identifier, 'brandOrBank', brand_or_bank,
              'expiry', expiry, 'accountHolderName', account_holder_name, 'bankName', bank_name, 'isDefault', is_default
            )) AS methods
            FROM registration_payment_methods GROUP BY request_id
          ) m ON m.request_id = r.id
          SET r.payment_methods = m.methods
        `);

        await queryRunner.query(`
          UPDATE registration_requests r
          JOIN registration_deposits d ON d.request_id = r.id
          SET r.security_deposit_amount = d.amount, r.deposit_payment_status = d.status,
              r.deposit_payment_method = d.payment_method, r.deposit_payment_reference = d.payment_reference,
              r.deposit_paid_date = d.paid_at
        `);

        await queryRunner.query(`DROP INDEX \`IDX_8a324ab99f1c42a2d3fdcb1415\` ON \`registration_request_units\``);
        await queryRunner.query(`DROP INDEX \`IDX_665a296f66e44faf395433b770\` ON \`registration_request_units\``);
        await queryRunner.query(`DROP TABLE \`registration_request_units\``);
        await queryRunner.query(`DROP INDEX \`REL_f70d6a201531bc1c89d9d767ed\` ON \`registration_deposits\``);
        await queryRunner.query(`DROP TABLE \`registration_deposits\``);
        await queryRunner.query(`DROP TABLE \`registration_payment_methods\``);
        await queryRunner.query(`DROP INDEX \`IDX_bfb536638f2594cd8eaa81ea75\` ON \`registration_request_property_billing\``);
        await queryRunner.query(`DROP TABLE \`registration_request_property_billing\``);
        await queryRunner.query(`DROP INDEX \`REL_3f28b1d5ac6df45bfeff4ff04f\` ON \`registration_customer_details\``);
        await queryRunner.query(`DROP TABLE \`registration_customer_details\``);
    }

}
