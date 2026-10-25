SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'ktv_guest_count') = 0,
  'ALTER TABLE bookings ADD COLUMN ktv_guest_count INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE bookings
SET ktv_guest_count = LEAST(15, GREATEST(1, people))
WHERE id > 0 AND ktv_addon = 1 AND ktv_guest_count = 0;

CREATE TABLE IF NOT EXISTS booking_revenue_contributions (
  booking_id INT NOT NULL PRIMARY KEY,
  revenue_date DATE NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  guest_count INT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_booking_revenue_date (revenue_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO booking_revenue_contributions (booking_id, revenue_date, amount, guest_count)
SELECT id, DATE(checkin), total_price, 1
FROM bookings
WHERE status = 'approved' AND checkin IS NOT NULL;
