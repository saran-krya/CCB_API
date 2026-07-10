-- =============================================================================
-- ONE-TIME MySQL MIGRATION: billing_cycles (single self-versioned table)
-- -> billing_cycle_masters + billing_cycle_versions (master+version split).
--
-- Run this ONCE on the existing MySQL database, then restart the application.
-- TypeORM synchronize will add the new FK constraints automatically on startup
-- (same convention as migration-user-types-lov.sql).
--
-- Staged per MySQL's transaction model: DDL (CREATE TABLE) auto-commits and
-- cannot be rolled back, so it runs first and is purely additive/non-destructive
-- (IF NOT EXISTS — safe to re-run). The actual data movement is DML wrapped in
-- a real transaction that rolls back cleanly on any failure. The old table is
-- renamed, not dropped, so this is fully reversible until you explicitly drop
-- billing_cycles_deprecated_20260709 later once you've verified the app works.
--
-- Design notes baked into this migration:
--  - billing_cycle_versions keeps the EXACT same row IDs the old billing_cycles
--    table used, so every existing audit_log.entity_id reference (module_name
--    = 'billing_cycles') keeps resolving correctly with zero backfill.
--  - The old single-table design let a property accumulate more than one
--    disconnected lineage (create() could start a brand-new row/business-code
--    once the only existing lineage was fully deprecated). This migration
--    consolidates every version for a given property under ONE master,
--    keyed by property_id (now UNIQUE) - the fragmentation bug this exact
--    redesign was meant to close.
--  - Business codes are regenerated as ILCY-<master id> (this dev database's
--    only fragmented lineage — property_id 1 — has two legacy codes,
--    ILCY-000002 and ILCY-000004, from that same bug; there is no single
--    correct legacy code to keep). For a production migration with business
--    codes already visible to end users, prefer keeping the earliest
--    lineage's historical code instead of regenerating.
--  - current_version_id is backfilled from the actual invariant the new
--    service enforces: at most one version per master is ever ACTIVE or
--    INACTIVE at a time (every other transition either supersedes-and-
--    deprecates or never activated) - so "most recent ACTIVE/INACTIVE row"
--    is unambiguous, unlike the old findByProperty()'s looser
--    "prefer ACTIVE, else most recent non-deprecated" scan.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Stage 1 (DDL, auto-commits): create the two new tables additively.
-- Column shapes mirror BillingCycleMaster/BillingCycleVersion exactly; FK
-- constraints are intentionally omitted here and left for TypeORM synchronize
-- to add on next app startup, matching this repo's established convention.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `billing_cycle_masters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  `business_code` varchar(20) DEFAULT NULL,
  `community_id` int NOT NULL,
  `property_id` int NOT NULL,
  `current_version_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_cycle_masters_business_code` (`business_code`),
  UNIQUE KEY `uq_billing_cycle_masters_property_id` (`property_id`),
  KEY `idx_billing_cycle_masters_community_id` (`community_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `billing_cycle_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  `master_id` int NOT NULL,
  `frequency` varchar(50) NOT NULL DEFAULT 'monthly',
  `reading_start_day` smallint NOT NULL,
  `reading_end_day` smallint NOT NULL,
  `bill_generation_days` smallint NOT NULL DEFAULT '0',
  `bill_issue_days` smallint NOT NULL DEFAULT '0',
  `bill_due_days` smallint NOT NULL DEFAULT '1',
  `status` enum('active','inactive','pending','rejected','deprecated') NOT NULL DEFAULT 'inactive',
  `last_change_reason` text,
  `change_reason_code` varchar(50) DEFAULT NULL,
  `version` varchar(10) NOT NULL DEFAULT '1.0',
  `parent_version_id` int DEFAULT NULL,
  `effective_from` date DEFAULT NULL,
  `submitted_by_id` int DEFAULT NULL,
  `submitted_on` date DEFAULT NULL,
  `approved_by_id` int DEFAULT NULL,
  `approval_date` date DEFAULT NULL,
  `rejection_notes` text,
  `deprecation_reason_code` varchar(50) DEFAULT NULL,
  `deprecation_notes` text,
  `deprecated_on` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_billing_cycle_versions_master_id` (`master_id`),
  KEY `idx_billing_cycle_versions_parent_version_id` (`parent_version_id`),
  KEY `idx_billing_cycle_versions_submitted_by_id` (`submitted_by_id`),
  KEY `idx_billing_cycle_versions_approved_by_id` (`approved_by_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------------
-- Stage 2 (DML, transactional): backfill masters, then versions preserving
-- IDs, then the current_version_id pointer. Rolls back cleanly on any error.
-- ---------------------------------------------------------------------------

START TRANSACTION;

-- 2a. One master per distinct property_id — community_id/business_code taken
-- from that property's earliest (lowest id) legacy row, i.e. the head of its
-- oldest lineage. Every row (including soft-deleted ones) is considered, so
-- no history is silently dropped even if a property's only rows are deleted.
INSERT INTO `billing_cycle_masters` (`business_code`, `community_id`, `property_id`, `created_at`, `updated_at`)
SELECT earliest.business_code, earliest.community_id, earliest.property_id, NOW(), NOW()
FROM (
  SELECT
    bc.property_id,
    bc.community_id,
    bc.business_code,
    ROW_NUMBER() OVER (PARTITION BY bc.property_id ORDER BY bc.id ASC) AS rn
  FROM billing_cycles bc
) earliest
WHERE earliest.rn = 1;

-- Regenerate business codes from the new master IDs (see design notes above
-- for why this dev database's one fragmented lineage makes "keep the legacy
-- code" ambiguous).
UPDATE `billing_cycle_masters`
SET `business_code` = CONCAT('ILCY-', LPAD(id, 6, '0'));

-- 2b. Every legacy row becomes a version row under its property's master,
-- with its ID preserved exactly and parent_billing_cycle_id carried straight
-- across into parent_version_id (old and new version-row IDs are identical,
-- so no remapping is needed there — only master_id is newly resolved).
INSERT INTO `billing_cycle_versions` (
  `id`, `created_at`, `updated_at`, `deleted_at`, `master_id`, `frequency`,
  `reading_start_day`, `reading_end_day`, `bill_generation_days`, `bill_issue_days`, `bill_due_days`,
  `status`, `last_change_reason`, `change_reason_code`, `version`, `parent_version_id`, `effective_from`,
  `submitted_by_id`, `submitted_on`, `approved_by_id`, `approval_date`, `rejection_notes`,
  `deprecation_reason_code`, `deprecation_notes`, `deprecated_on`
)
SELECT
  bc.id, bc.created_at, bc.updated_at, bc.deleted_at, m.id, bc.frequency,
  bc.reading_start_day, bc.reading_end_day, bc.bill_generation_days, bc.bill_issue_days, bc.bill_due_days,
  bc.status, bc.last_change_reason, bc.change_reason_code, bc.version, bc.parent_billing_cycle_id, bc.effective_from,
  bc.submitted_by_id, bc.submitted_on, bc.approved_by_id, bc.approval_date, bc.rejection_notes,
  bc.deprecation_reason_code, bc.deprecation_notes, bc.deprecated_on
FROM billing_cycles bc
INNER JOIN billing_cycle_masters m ON m.property_id = bc.property_id;

-- 2c. Point each master at whichever version is currently governing it —
-- the most recent row still ACTIVE or INACTIVE (there should be at most one;
-- MAX(id) is a defensive tie-break, not an expected occurrence). Left NULL
-- when every version for that property is PENDING, REJECTED, or DEPRECATED.
UPDATE `billing_cycle_masters` m
SET m.`current_version_id` = (
  SELECT v.id
  FROM `billing_cycle_versions` v
  WHERE v.master_id = m.id
    AND v.status IN ('active', 'inactive')
  ORDER BY v.id DESC
  LIMIT 1
);

-- Keep both AUTO_INCREMENT counters ahead of the highest ID now in use.
-- (InnoDB already does this automatically on explicit-ID inserts — this is
-- belt-and-braces, not strictly required.)
SET @next_version_id = (SELECT COALESCE(MAX(id), 0) + 1 FROM `billing_cycle_versions`);
SET @sql = CONCAT('ALTER TABLE `billing_cycle_versions` AUTO_INCREMENT = ', @next_version_id);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

COMMIT;


-- ---------------------------------------------------------------------------
-- Stage 3: verification — eyeball these before touching the old table.
-- ---------------------------------------------------------------------------

-- Row counts must match exactly (every legacy row became exactly one version row).
SELECT
  (SELECT COUNT(*) FROM billing_cycles)          AS legacy_row_count,
  (SELECT COUNT(*) FROM billing_cycle_versions)  AS new_version_row_count,
  (SELECT COUNT(DISTINCT property_id) FROM billing_cycles) AS distinct_properties,
  (SELECT COUNT(*) FROM billing_cycle_masters)   AS new_master_row_count;

-- Per-master detail: business code, property, and the resolved governing version.
SELECT
  m.id AS master_id,
  m.business_code,
  m.property_id,
  m.community_id,
  m.current_version_id,
  v.version AS current_version_number,
  v.status  AS current_version_status,
  (SELECT COUNT(*) FROM billing_cycle_versions vv WHERE vv.master_id = m.id) AS total_versions_in_lineage
FROM billing_cycle_masters m
LEFT JOIN billing_cycle_versions v ON v.id = m.current_version_id
ORDER BY m.id;

-- Every version's status, to compare 1:1 against the legacy table by ID.
SELECT id, master_id, version, status, parent_version_id, effective_from, deprecated_on
FROM billing_cycle_versions
ORDER BY id;

-- Must return zero rows: every version's master_id must resolve to a real master.
SELECT v.id, v.master_id
FROM billing_cycle_versions v
LEFT JOIN billing_cycle_masters m ON m.id = v.master_id
WHERE m.id IS NULL;


-- ---------------------------------------------------------------------------
-- Stage 4: retire the old table WITHOUT dropping it — reversible safety net.
-- Only run this after Stage 3's output looks correct. Drop
-- billing_cycles_deprecated_20260709 yourself once you're confident the app
-- is working end-to-end on the new tables (approve/reject/deprecate/scheduler
-- sweeps all verified) — this script deliberately does not drop it for you.
-- ---------------------------------------------------------------------------

RENAME TABLE `billing_cycles` TO `billing_cycles_deprecated_20260709`;
