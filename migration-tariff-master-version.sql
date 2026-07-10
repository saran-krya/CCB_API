-- =============================================================================
-- ONE-TIME MySQL MIGRATION: tariffs (single self-versioned table)
-- -> tariff_masters + tariff_versions (master+version split), mirroring the
-- billing_cycles -> billing_cycle_masters/billing_cycle_versions migration.
--
-- Run this ONCE on the existing MySQL database, then restart the application.
-- TypeORM synchronize will add the new FK constraints (including repointing
-- tariff_tiers/tariff_properties/tariff_units at tariff_versions) automatically
-- on startup — same convention as migration-user-types-lov.sql and
-- migration-billing-cycle-master-version.sql.
--
-- Staged per MySQL's transaction model: DDL (CREATE TABLE) auto-commits and
-- cannot be rolled back, so it runs first and is purely additive/non-destructive
-- (IF NOT EXISTS — safe to re-run). The actual data movement is DML wrapped in
-- a real transaction that rolls back cleanly on any failure. The old table is
-- renamed, not dropped, so this is fully reversible until you explicitly drop
-- tariffs_deprecated_20260709 later once you've verified the app works.
--
-- Design notes baked into this migration:
--  - tariff_versions keeps the EXACT same row IDs the old tariffs table used,
--    so every existing audit_log.entity_id reference (module_name = 'Tariff')
--    keeps resolving correctly with zero backfill.
--  - tariff_tiers, tariff_properties and tariff_units are NOT touched by this
--    script at all. Their tariff_id column is kept as-is (not renamed) —
--    only its FK target moves, from tariffs(id) to tariff_versions(id), and
--    since version IDs equal the legacy tariff IDs exactly, every existing
--    row in those three tables stays valid with zero data changes. TypeORM
--    synchronize repoints the FK constraint on next boot.
--  - Every row in this dev database's `tariffs` table is already its own
--    root lineage with a unique business_code (TAR-<own id>) — unlike
--    billing_cycles, this module's create() never reused an existing row,
--    so there is no fragmentation to consolidate here. One master is
--    created per existing business_code.
--  - tariff_masters has no "current version" pointer, unlike
--    billing_cycle_masters — see TariffMaster's entity comment for why a
--    tariff lineage has no single unambiguous "current" version the way a
--    billing cycle's per-property lineage does.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Stage 1 (DDL, auto-commits): create the two new tables additively.
-- Column shapes mirror TariffMaster/TariffVersion exactly; FK constraints
-- are intentionally omitted here and left for TypeORM synchronize to add on
-- next app startup, matching this repo's established convention.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `tariff_masters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  `business_code` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tariff_masters_business_code` (`business_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tariff_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  `master_id` int NOT NULL,
  `name` varchar(160) NOT NULL,
  `status` enum('draft','pending','request_for_correction','active','inactive','deprecated','expired','rejected') NOT NULL DEFAULT 'draft',
  `rate_type` enum('flat','tiered') NOT NULL,
  `applicability` enum('global','property','unit') NOT NULL DEFAULT 'global',
  `flat_rate` decimal(10,4) DEFAULT NULL,
  `billing_service_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `activation_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `security_deposit` decimal(10,2) NOT NULL DEFAULT '0.00',
  `late_payment_penalty` decimal(10,2) NOT NULL DEFAULT '0.00',
  `disconnection_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `reconnection_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `tampering_penalty` decimal(10,2) NOT NULL DEFAULT '0.00',
  `noc_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `move_out_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `vat` decimal(5,2) NOT NULL DEFAULT '5.00',
  `effective_from` date DEFAULT NULL,
  `effective_to` date DEFAULT NULL,
  `description` text,
  `submitted_on` date DEFAULT NULL,
  `approval_date` date DEFAULT NULL,
  `rejection_reason` varchar(100) DEFAULT NULL,
  `rejection_notes` text,
  `submitted_by_id` int DEFAULT NULL,
  `approved_by_id` int DEFAULT NULL,
  `late_payment_penalty_type` enum('flat','percentage') NOT NULL DEFAULT 'flat',
  `bounced_cheque_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `meter_verification_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `meter_rental_enabled` tinyint NOT NULL DEFAULT '0',
  `meter_rental_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `vat_registration_number` varchar(15) DEFAULT NULL,
  `vat_applicable_fees` text,
  `version` varchar(10) NOT NULL DEFAULT '1.0',
  `parent_version_id` int DEFAULT NULL,
  `property_type` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tariff_versions_master_id` (`master_id`),
  KEY `idx_tariff_versions_parent_version_id` (`parent_version_id`),
  KEY `idx_tariff_versions_submitted_by_id` (`submitted_by_id`),
  KEY `idx_tariff_versions_approved_by_id` (`approved_by_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------------
-- Stage 2 (DML, transactional): backfill masters, then versions preserving
-- IDs. Rolls back cleanly on any error.
-- ---------------------------------------------------------------------------

START TRANSACTION;

-- 2a. One master per distinct business_code (every row here is already its
-- own root lineage — see design notes above). Rows with a NULL business
-- code (shouldn't exist given create() always assigns one, but handled
-- defensively) each get their own master too, keyed 1:1 by tariff id via a
-- temporary placeholder code so 2b can correlate them correctly — plain
-- `business_code IS NULL` would otherwise match every such tariff to
-- whichever NULL-coded master happened to be picked first. The placeholder
-- is cleared back to NULL immediately after 2b.
INSERT INTO `tariff_masters` (`business_code`, `created_at`, `updated_at`)
SELECT DISTINCT t.business_code, NOW(), NOW()
FROM tariffs t
WHERE t.business_code IS NOT NULL;

INSERT INTO `tariff_masters` (`business_code`, `created_at`, `updated_at`)
SELECT CONCAT('__migration_placeholder_', t.id), NOW(), NOW()
FROM tariffs t
WHERE t.business_code IS NULL;

-- 2b. Every legacy row becomes a version row under its lineage's master,
-- with its ID preserved exactly and parent_tariff_id carried straight
-- across into parent_version_id (old and new version-row IDs are identical,
-- so no remapping is needed there — only master_id is newly resolved).
-- NULL-business-code rows are matched back to the single-row master created
-- for them above via their own id (see 2a).
INSERT INTO `tariff_versions` (
  `id`, `created_at`, `updated_at`, `deleted_at`, `master_id`, `name`, `status`, `rate_type`, `applicability`,
  `flat_rate`, `billing_service_fee`, `activation_fee`, `security_deposit`, `late_payment_penalty`,
  `disconnection_fee`, `reconnection_fee`, `tampering_penalty`, `noc_fee`, `move_out_fee`, `vat`,
  `effective_from`, `effective_to`, `description`, `submitted_on`, `approval_date`, `rejection_reason`,
  `rejection_notes`, `submitted_by_id`, `approved_by_id`, `late_payment_penalty_type`, `bounced_cheque_fee`,
  `meter_verification_fee`, `meter_rental_enabled`, `meter_rental_fee`, `vat_registration_number`,
  `vat_applicable_fees`, `version`, `parent_version_id`, `property_type`
)
SELECT
  t.id, t.created_at, t.updated_at, t.deleted_at, m.id, t.name, t.status, t.rate_type, t.applicability,
  t.flat_rate, t.billing_service_fee, t.activation_fee, t.security_deposit, t.late_payment_penalty,
  t.disconnection_fee, t.reconnection_fee, t.tampering_penalty, t.noc_fee, t.move_out_fee, t.vat,
  t.effective_from, t.effective_to, t.description, t.submitted_on, t.approval_date, t.rejection_reason,
  t.rejection_notes, t.submitted_by_id, t.approved_by_id, t.late_payment_penalty_type, t.bounced_cheque_fee,
  t.meter_verification_fee, t.meter_rental_enabled, t.meter_rental_fee, t.vat_registration_number,
  t.vat_applicable_fees, t.version, t.parent_tariff_id, t.property_type
FROM tariffs t
LEFT JOIN tariff_masters m ON t.business_code IS NOT NULL AND m.business_code = t.business_code
WHERE t.business_code IS NOT NULL

UNION ALL

SELECT
  t.id, t.created_at, t.updated_at, t.deleted_at, m.id,
  t.name, t.status, t.rate_type, t.applicability,
  t.flat_rate, t.billing_service_fee, t.activation_fee, t.security_deposit, t.late_payment_penalty,
  t.disconnection_fee, t.reconnection_fee, t.tampering_penalty, t.noc_fee, t.move_out_fee, t.vat,
  t.effective_from, t.effective_to, t.description, t.submitted_on, t.approval_date, t.rejection_reason,
  t.rejection_notes, t.submitted_by_id, t.approved_by_id, t.late_payment_penalty_type, t.bounced_cheque_fee,
  t.meter_verification_fee, t.meter_rental_enabled, t.meter_rental_fee, t.vat_registration_number,
  t.vat_applicable_fees, t.version, t.parent_tariff_id, t.property_type
FROM tariffs t
INNER JOIN tariff_masters m ON m.business_code = CONCAT('__migration_placeholder_', t.id)
WHERE t.business_code IS NULL;

-- Clear the temporary placeholder codes back to NULL now that 2b has used
-- them to correlate each NULL-coded tariff to its own dedicated master.
UPDATE `tariff_masters`
SET `business_code` = NULL
WHERE `business_code` LIKE '__migration_placeholder_%';

-- Keep the AUTO_INCREMENT counter ahead of the highest ID now in use.
-- (InnoDB already does this automatically on explicit-ID inserts — this is
-- belt-and-braces, not strictly required.)
SET @next_version_id = (SELECT COALESCE(MAX(id), 0) + 1 FROM `tariff_versions`);
SET @sql = CONCAT('ALTER TABLE `tariff_versions` AUTO_INCREMENT = ', @next_version_id);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

COMMIT;


-- ---------------------------------------------------------------------------
-- Stage 3: verification — eyeball these before touching the old table.
-- ---------------------------------------------------------------------------

-- Row counts must match exactly (every legacy row became exactly one version row).
SELECT
  (SELECT COUNT(*) FROM tariffs)                                AS legacy_row_count,
  (SELECT COUNT(*) FROM tariff_versions)                        AS new_version_row_count,
  (SELECT COUNT(DISTINCT business_code) FROM tariffs WHERE business_code IS NOT NULL)
    + (SELECT COUNT(*) FROM tariffs WHERE business_code IS NULL) AS expected_master_count,
  (SELECT COUNT(*) FROM tariff_masters)                         AS new_master_count;

-- Per-master detail: business code and how many versions ended up under it.
SELECT
  m.id AS master_id,
  m.business_code,
  (SELECT COUNT(*) FROM tariff_versions v WHERE v.master_id = m.id) AS total_versions_in_lineage
FROM tariff_masters m
ORDER BY m.id;

-- Every version's status/scope, to compare 1:1 against the legacy table by ID.
SELECT id, master_id, version, status, parent_version_id, property_type, applicability
FROM tariff_versions
ORDER BY id;

-- Must return zero rows: every version's master_id must resolve to a real master.
SELECT v.id, v.master_id
FROM tariff_versions v
LEFT JOIN tariff_masters m ON m.id = v.master_id
WHERE m.id IS NULL;

-- Must return zero rows: tariff_tiers/tariff_properties/tariff_units rows
-- whose tariff_id no longer resolves to a real version (should be
-- impossible, since version IDs == legacy tariff IDs exactly, but confirms it).
SELECT 'tariff_tiers' AS tbl, tt.id, tt.tariff_id FROM tariff_tiers tt
LEFT JOIN tariff_versions v ON v.id = tt.tariff_id WHERE tt.tariff_id IS NOT NULL AND v.id IS NULL
UNION ALL
SELECT 'tariff_properties' AS tbl, NULL, tp.tariff_id FROM tariff_properties tp
LEFT JOIN tariff_versions v ON v.id = tp.tariff_id WHERE v.id IS NULL
UNION ALL
SELECT 'tariff_units' AS tbl, NULL, tu.tariff_id FROM tariff_units tu
LEFT JOIN tariff_versions v ON v.id = tu.tariff_id WHERE v.id IS NULL;


-- ---------------------------------------------------------------------------
-- Stage 4: retire the old table WITHOUT dropping it — reversible safety net.
-- tariff_tiers/tariff_properties/tariff_units are deliberately left alone;
-- their tariff_id FK will point at this renamed table until the app
-- restarts and TypeORM synchronize repoints it at tariff_versions.
-- Only run this after Stage 3's output looks correct. Drop
-- tariffs_deprecated_20260709 yourself once you're confident the app is
-- working end-to-end on the new tables — this script deliberately does not
-- drop it for you.
-- ---------------------------------------------------------------------------

RENAME TABLE `tariffs` TO `tariffs_deprecated_20260709`;
