-- =============================================================================
-- ONE-TIME MySQL MIGRATION: Remap roles.user_category_id / user_type_id
-- from legacy user_categories/user_types tables to lov_values.
--
-- Run this ONCE on the existing MySQL database, then restart the application.
-- TypeORM synchronize will add the new FK constraints automatically on startup.
--
-- Safe to re-run: INSERT IGNORE skips rows that already exist.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Drop existing FK constraints on roles (if still present).
-- TypeORM may have already dropped them on the failed startup attempt;
-- this handles both cases gracefully via dynamic SQL.
-- ---------------------------------------------------------------------------

SET @fk_cat = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'roles'
    AND COLUMN_NAME = 'user_category_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @sql = IF(@fk_cat IS NOT NULL,
  CONCAT('ALTER TABLE `roles` DROP FOREIGN KEY `', @fk_cat, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_type = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'roles'
    AND COLUMN_NAME = 'user_type_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @sql = IF(@fk_type IS NOT NULL,
  CONCAT('ALTER TABLE `roles` DROP FOREIGN KEY `', @fk_type, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Step 2: Insert USER_CATEGORY values from user_categories into lov_values.
-- INSERT IGNORE skips rows where (category, code) already exists.
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO lov_values (category, code, label, display_order, is_active, created_at, updated_at)
SELECT
  'USER_CATEGORY',
  LOWER(name),
  name,
  ROW_NUMBER() OVER (ORDER BY id),
  active,
  NOW(),
  NOW()
FROM user_categories
WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 3: Insert USER_TYPE values from user_types into lov_values.
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO lov_values (category, code, label, display_order, is_active, created_at, updated_at)
SELECT
  'USER_TYPE',
  LOWER(name),
  name,
  ROW_NUMBER() OVER (ORDER BY id),
  is_active,
  NOW(),
  NOW()
FROM user_types
WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 4: Remap roles.user_category_id to the new lov_values.id.
-- Matches on LOWER(user_categories.name) = lov_values.code.
-- ---------------------------------------------------------------------------

UPDATE roles r
INNER JOIN user_categories uc ON r.user_category_id = uc.id
INNER JOIN lov_values lv
  ON lv.category = 'USER_CATEGORY'
  AND lv.code = LOWER(uc.name)
  AND lv.deleted_at IS NULL
SET r.user_category_id = lv.id
WHERE uc.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 5: Remap roles.user_type_id to the new lov_values.id.
-- ---------------------------------------------------------------------------

UPDATE roles r
INNER JOIN user_types ut ON r.user_type_id = ut.id
INNER JOIN lov_values lv
  ON lv.category = 'USER_TYPE'
  AND lv.code = LOWER(ut.name)
  AND lv.deleted_at IS NULL
SET r.user_type_id = lv.id
WHERE ut.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Verify: confirm all roles now reference valid lov_values rows.
-- Every row should show a non-null category_label and type_label.
-- ---------------------------------------------------------------------------

SELECT
  r.id,
  r.role_name,
  r.user_category_id,
  lvc.label AS category_label,
  r.user_type_id,
  lvt.label  AS type_label
FROM roles r
LEFT JOIN lov_values lvc ON lvc.id = r.user_category_id AND lvc.category = 'USER_CATEGORY'
LEFT JOIN lov_values lvt ON lvt.id = r.user_type_id     AND lvt.category = 'USER_TYPE'
WHERE r.deleted_at IS NULL
ORDER BY r.id;
