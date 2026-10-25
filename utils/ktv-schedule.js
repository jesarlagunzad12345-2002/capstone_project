const KTV_TIME_SLOTS = [
  { start: '08:00:00', end: '11:00:00', label: '8:00 AM–11:00 AM' },
  { start: '11:00:00', end: '14:00:00', label: '11:00 AM–2:00 PM' },
  { start: '15:00:00', end: '18:00:00', label: '3:00 PM–6:00 PM' }
];

const KTV_LOCK_NAME = 'kml_resort_ktv_schedule';

function normalizeKtvStartTime(value) {
  const normalized = typeof value === 'string' && value.length === 5 ? `${value}:00` : value;
  return KTV_TIME_SLOTS.some(slot => slot.start === normalized) ? normalized : null;
}

async function withKtvScheduleLock(callback) {
  const connection = await require('../config/database').promise().getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [KTV_LOCK_NAME]);
    if (Number(lockRows[0].acquired) !== 1) {
      throw new Error('Could not acquire the KTV schedule lock.');
    }
    lockAcquired = true;
    return await callback(connection);
  } finally {
    try {
      if (lockAcquired) {
        await connection.query('SELECT RELEASE_LOCK(?)', [KTV_LOCK_NAME]);
      }
    } finally {
      connection.release();
    }
  }
}

async function findKtvConflict(connection, bookingDate, startTime, excludeBookingId = null) {
  const [rows] = await connection.query(`
    SELECT id, bookingSource, status, ktv_start_time
    FROM bookings
    WHERE ktv_addon = 1
      AND COALESCE(ktv_booking_date, DATE(checkin)) = ?
      AND (
        status IN ('pending', 'approved')
        OR (status = 'pending_payment' AND hold_expires_at > NOW())
      )
      AND (? IS NULL OR id <> ?)
      AND (ktv_start_time IS NULL OR ktv_start_time = ?)
    LIMIT 1
  `, [bookingDate, excludeBookingId, excludeBookingId, startTime]);
  return rows[0] || null;
}

function isMondayOrTuesday(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  return date.getDay() === 1 || date.getDay() === 2;
}

module.exports = {
  KTV_TIME_SLOTS,
  normalizeKtvStartTime,
  withKtvScheduleLock,
  findKtvConflict,
  isMondayOrTuesday
};
