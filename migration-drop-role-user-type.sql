-- =============================================================================
-- ONE-TIME MySQL MIGRATION: Drop Role Type (roles.user_type_id) support.
--
-- Role Type was removed from the Role model — determined unnecessary for
-- this product. Role Name uniqueness is now scoped by roleName alone
-- (previously roleName + userCategoryId + userTypeId).
--
-- Run this ONCE against any environment where `synchronize` is disabled
-- (production). Dev/local environments with `synchronize: true` apply the
-- equivalent column drop automatically on the next server restart — this
-- script exists for parity with that automatic behavior.
--
-- Note: the USER_TYPE lov_values rows (Employee/Customer) and lov_categories
-- entry are intentionally left in place — they are generic, admin-
-- configurable master data owned by the Lookup Field Master screen, not
-- something this migration should silently delete.
--
-- Safe to re-run: every statement checks for existence first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Drop the FK constraint on roles.user_type_id, if present.
-- ---------------------------------------------------------------------------

SET @fk_user_type = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'roles'
    AND COLUMN_NAME = 'user_type_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @sql = IF(@fk_user_type IS NOT NULL,
  CONCAT('ALTER TABLE `roles` DROP FOREIGN KEY `', @fk_user_type, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Step 2: Drop the roles.user_type_id column, if present.
-- ---------------------------------------------------------------------------

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'roles'
    AND COLUMN_NAME = 'user_type_id'
);
SET @sql = IF(@col_exists > 0,
  'ALTER TABLE `roles` DROP COLUMN `user_type_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
