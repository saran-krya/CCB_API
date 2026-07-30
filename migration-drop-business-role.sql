-- =============================================================================
-- ONE-TIME MySQL MIGRATION: Drop Business Role support.
--
-- Business Title (BusinessRole) was removed — determined to be redundant
-- with the existing Job Title (users.designation) field and to carry no
-- business logic beyond storing a decorative label.
--
-- Run this ONCE against any environment where `synchronize` is disabled
-- (production). Dev/local environments with `synchronize: true` apply the
-- equivalent column/table drop automatically on the next server restart —
-- this script exists for parity with that automatic behavior.
--
-- Safe to re-run: every statement checks for existence first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Drop the FK constraint on users.business_role_id, if present.
-- ---------------------------------------------------------------------------

SET @fk_business_role = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'business_role_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @sql = IF(@fk_business_role IS NOT NULL,
  CONCAT('ALTER TABLE `users` DROP FOREIGN KEY `', @fk_business_role, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Step 2: Drop the users.business_role_id column, if present.
-- ---------------------------------------------------------------------------

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'business_role_id'
);
SET @sql = IF(@col_exists > 0,
  'ALTER TABLE `users` DROP COLUMN `business_role_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Step 3: Drop the business_roles table itself, if present.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS `business_roles`;
