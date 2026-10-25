-- Safe to run repeatedly. Existing columns are skipped.

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'pool_addon') = 0,
    'ALTER TABLE bookings ADD COLUMN pool_addon TINYINT NOT NULL DEFAULT 0',
    'SELECT ''pool_addon already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'pool_adult_count') = 0,
    'ALTER TABLE bookings ADD COLUMN pool_adult_count INT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT ''pool_adult_count already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'pool_child_count') = 0,
    'ALTER TABLE bookings ADD COLUMN pool_child_count INT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT ''pool_child_count already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'pool_fee') = 0,
    'ALTER TABLE bookings ADD COLUMN pool_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00',
    'SELECT ''pool_fee already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'ktv_addon') = 0,
    'ALTER TABLE bookings ADD COLUMN ktv_addon TINYINT NOT NULL DEFAULT 0',
    'SELECT ''ktv_addon already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'ktv_fee') = 0,
    'ALTER TABLE bookings ADD COLUMN ktv_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00',
    'SELECT ''ktv_fee already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'overnight_extra_guest_count') = 0,
    'ALTER TABLE bookings ADD COLUMN overnight_extra_guest_count INT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT ''overnight_extra_guest_count already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'overnight_extra_guest_rate') = 0,
    'ALTER TABLE bookings ADD COLUMN overnight_extra_guest_rate DECIMAL(10,2) NOT NULL DEFAULT 200.00',
    'SELECT ''overnight_extra_guest_rate already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'overnight_extra_guest_fee') = 0,
    'ALTER TABLE bookings ADD COLUMN overnight_extra_guest_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00',
    'SELECT ''overnight_extra_guest_fee already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'entrance_fee_per_person') = 0,
    'ALTER TABLE bookings ADD COLUMN entrance_fee_per_person DECIMAL(10,2) NOT NULL DEFAULT 0.00',
    'SELECT ''entrance_fee_per_person already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'entrance_fee_total') = 0,
    'ALTER TABLE bookings ADD COLUMN entrance_fee_total DECIMAL(10,2) NOT NULL DEFAULT 0.00',
    'SELECT ''entrance_fee_total already exists; skipped'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
