SET @previous_sql_safe_updates = @@SQL_SAFE_UPDATES;
SET SQL_SAFE_UPDATES = 0;

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS revenue_date_corrections;

CREATE TEMPORARY TABLE revenue_date_corrections (
    booking_id INT NOT NULL PRIMARY KEY,
    previous_date DATE NOT NULL,
    correct_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    guest_count INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

INSERT INTO revenue_date_corrections
SELECT
    c.booking_id,
    c.revenue_date AS previous_date,
    DATE(b.checkin) AS correct_date,
    c.amount,
    c.guest_count
FROM booking_revenue_contributions c
JOIN bookings b ON b.id = c.booking_id
WHERE b.checkin IS NOT NULL
  AND c.revenue_date <> DATE(b.checkin);

UPDATE daily_revenue d
JOIN (
    SELECT previous_date, SUM(amount) AS amount, SUM(guest_count) AS guest_count
    FROM revenue_date_corrections 
    GROUP BY previous_date
) moved ON moved.previous_date = d.revenue_date
SET d.total_amount = GREATEST(0, d.total_amount - moved.amount),
    d.guest_count = GREATEST(0, d.guest_count - moved.guest_count);

INSERT INTO daily_revenue (revenue_date, total_amount, guest_count, last_reset)
SELECT correct_date, 0, 0, NOW()
FROM (SELECT DISTINCT correct_date FROM revenue_date_corrections) dates
WHERE NOT EXISTS (
    SELECT 1
    FROM daily_revenue existing
    WHERE existing.revenue_date = dates.correct_date
);

UPDATE daily_revenue d
JOIN (
    SELECT correct_date, SUM(amount) AS amount, SUM(guest_count) AS guest_count
    FROM revenue_date_corrections
    GROUP BY correct_date
) moved ON moved.correct_date = d.revenue_date
SET d.total_amount = d.total_amount + moved.amount,
    d.guest_count = d.guest_count + moved.guest_count;

UPDATE booking_revenue_contributions c
JOIN revenue_date_corrections moved ON moved.booking_id = c.booking_id
SET c.revenue_date = moved.correct_date;

DROP TEMPORARY TABLE revenue_date_corrections;

COMMIT;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'guest_name') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN guest_name VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'email') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN email VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'room_type') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN room_type VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'people') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN people INT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'booking_status') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN booking_status VARCHAR(50) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'booking_source') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN booking_source VARCHAR(50) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'total_price') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN total_price DECIMAL(10,2) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'amount_paid') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN amount_paid DECIMAL(10,2) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'balance') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN balance DECIMAL(10,2) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'payment_method') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN payment_method VARCHAR(50) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_revenue_contributions' AND COLUMN_NAME = 'payment_status') = 0,
  'ALTER TABLE booking_revenue_contributions ADD COLUMN payment_status VARCHAR(50) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO booking_revenue_contributions (booking_id, revenue_date, amount, guest_count)
SELECT b.id, DATE(b.checkin), 0, 0
FROM bookings b
WHERE b.checkin IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM booking_revenue_contributions existing
      WHERE existing.booking_id = b.id
  );

UPDATE booking_revenue_contributions c
JOIN bookings b ON b.id = c.booking_id
SET c.revenue_date = DATE(b.checkin),
    c.guest_name = b.name,
    c.email = b.email,
    c.room_type = b.roomType,
    c.people = b.people,
    c.booking_status = b.status,
    c.booking_source = COALESCE(b.bookingSource, 'ONLINE'),
    c.total_price = b.total_price,
    c.amount_paid = b.amount_paid,
    c.balance = b.balance,
    c.payment_method = b.payment_method,
    c.payment_status = b.payment_status
WHERE b.checkin IS NOT NULL;

SET SQL_SAFE_UPDATES = @previous_sql_safe_updates;