const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const db = require("../config/database");

const dbQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
});

// ---- config ----
const DOWNPAYMENT_PERCENT = 0.30; // 30%
const HOLD_MINUTES = 30;

// ---- multer setup for receipt screenshots ----
// Vercel's deployed filesystem is read-only except for /tmp. Local runs
// continue to use public/uploads so receipt images remain directly served.
const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), "kml-receipts")
  : path.join(__dirname, "..", "public", "uploads", "receipts");
fs.mkdirSync(uploadDir, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `receipt_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const storage = process.env.VERCEL ? multer.memoryStorage() : diskStorage;

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error("Only JPG, PNG, or WEBP images are allowed for receipts."));
  }
});

// =====================================================================
// FIX: multer errors (bad file type, file too large) used to be
// forwarded to next(err) with no route-specific handler, which meant
// they fell through to the app's default HTML error page. The
// frontend's fetch().json() call would then throw on that HTML and
// show a generic "Server error" message instead of the real reason.
// This wrapper always answers with JSON.
// =====================================================================
function safeUploadSingle(fieldName) {
  const middleware = upload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err) {
        console.error("❌ Upload error:", err.message);
        return res.status(400).json({ success: false, message: err.message || "Failed to upload receipt." });
      }
      next();
    });
  };
}

// ---- same helpers already used elsewhere in the app ----
function isMondayOrTuesday(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 1 || dayOfWeek === 2;
}

function getAutoCheckout(checkinStr) {
  const [year, month, day] = checkinStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  while (date.getDay() === 1 || date.getDay() === 2) {
    date.setDate(date.getDate() + 1);
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// =====================================================================
// FIX: previously the ONLY way expired unpaid holds got removed was
// an external cron hitting /api/cleanup-expired-holds. If that cron
// was never set up (or paused), expired 'pending_payment' rows stuck
// around in the bookings table and could keep blocking a room/cottage
// as "already booked" even though the guest never actually paid.
// We now sweep expired holds inline, every time someone tries to
// create a new hold, so availability is always correct regardless of
// whether the external cron is running.
// =====================================================================
async function cleanupExpiredHolds() {
  try {
    const result = await dbQuery(
      `DELETE FROM bookings WHERE status = 'pending_payment' AND hold_expires_at < NOW()`
    );
    if (result.affectedRows > 0) {
      console.log(`🧹 Inline cleanup: removed ${result.affectedRows} expired unpaid hold(s).`);
    }
  } catch (err) {
    // Don't let a cleanup failure block a real booking attempt.
    console.error("❌ Inline cleanup error (non-fatal):", err);
  }
}

// =====================================================================
// STEP 1 — Create a temporary "hold" while the guest goes to pay.
// Mirrors the validation that used to live in POST /create, but stops
// short of finalizing the booking: it reserves the slot for
// HOLD_MINUTES while the guest pays and submits proof. This also
// blocks a SECOND guest from holding the same room/cottage at the
// same time (the overlap check below counts pending_payment rows too).
//
// FIX: the whole handler body — including reading req.body — is now
// inside the try/catch. Previously `const {...} = req.body` ran
// BEFORE the try block; if req.body was ever undefined (a parsing
// hiccup, a stray request, etc.) that destructure threw synchronously
// and Express never sent a response at all. The client's fetch would
// then hang or receive a non-JSON response, and calling res.json() on
// that threw a SyntaxError on the frontend — which is exactly the
// generic "Could not reserve your slot" alert you were seeing.
// =====================================================================
router.post("/api/create-hold", async (req, res) => {
  try {
    const body = req.body || {};
    const { name, email, people, roomType, requests, checkin, bookingDate, checkinTime, checkoutTime } = body;

    if (!name || !email || !roomType) {
      return res.status(400).json({ success: false, message: "Please fill in your name, email, and choose a room or cottage." });
    }

    if (!req.session.verificationCodes ||
        !req.session.verificationCodes[email] ||
        !req.session.verificationCodes[email].verified) {
      return res.status(400).json({ success: false, message: "Please verify your email first." });
    }

    // Sweep stale holds before checking availability (see note above).
    await cleanupExpiredHolds();

    const roomResults = await dbQuery("SELECT price, category, occupancy FROM rooms WHERE name = ? LIMIT 1", [roomType]);
    if (roomResults.length === 0) {
      return res.status(400).json({ success: false, message: "Selected accommodation not found." });
    }
    const roomCategory = roomResults[0].category;
    const isCottage = roomCategory === 'Cottage';
    const maxOccupancy = parseInt(roomResults[0].occupancy) || 1;
    let guestCount = parseInt(people) || 1;
    if (guestCount > maxOccupancy && maxOccupancy > 0) guestCount = maxOccupancy;

    let finalCheckin, finalCheckout, totalPrice, nights;

    if (isCottage) {
      if (!bookingDate || !checkinTime || !checkoutTime) {
        return res.status(400).json({ success: false, message: "Please fill in booking date, check-in and check-out time." });
      }
      if (isMondayOrTuesday(bookingDate)) {
        return res.status(400).json({ success: false, message: "We are closed every Monday and Tuesday." });
      }
      finalCheckin = bookingDate + ' ' + checkinTime + ':00';
      finalCheckout = bookingDate + ' ' + checkoutTime + ':00';

      // Overlap check counts ALL bookings, including other pending_payment
      // holds, so two guests can't both be mid-payment for the same slot.
      const overlap = await dbQuery(`
        SELECT id FROM bookings
        WHERE roomType = ? AND DATE(checkin) = DATE(?)
        LIMIT 1
      `, [roomType, finalCheckin]);
      if (overlap.length > 0) {
        return res.status(409).json({ success: false, message: `"${roomType}" is already booked on that date.` });
      }
      totalPrice = parseFloat(roomResults[0].price);
      nights = 0;
    } else {
      if (!checkin) {
        return res.status(400).json({ success: false, message: "Please select a check-in date." });
      }
      if (isMondayOrTuesday(checkin)) {
        return res.status(400).json({ success: false, message: "Check-in cannot be on Monday or Tuesday." });
      }
      finalCheckin = checkin;
      finalCheckout = getAutoCheckout(checkin);

      const overlap = await dbQuery(`
        SELECT id FROM bookings
        WHERE roomType = ? AND checkin < ? AND checkout > ?
        LIMIT 1
      `, [roomType, finalCheckout, finalCheckin]);
      if (overlap.length > 0) {
        return res.status(409).json({ success: false, message: `"${roomType}" is already booked for those dates.` });
      }
      nights = Math.max(1, Math.ceil((new Date(finalCheckout) - new Date(finalCheckin)) / (1000 * 60 * 60 * 24)));
      totalPrice = parseFloat(roomResults[0].price) * nights;
    }

    const downpayment = Math.ceil(totalPrice * DOWNPAYMENT_PERCENT);
    const holdExpires = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);

    const result = await dbQuery(
      `INSERT INTO bookings
        (name, email, people, checkin, checkout, roomType, requests, status,
         total_price, nights, downpayment_amount, payment_status, hold_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, 'unpaid', ?)`,
      [name, email, guestCount, finalCheckin, finalCheckout, roomType, requests || null,
       totalPrice, nights, downpayment, holdExpires]
    );

    res.json({
      success: true,
      bookingId: result.insertId,
      totalPrice,
      downpayment,
      holdExpiresAt: holdExpires,
      holdMinutes: HOLD_MINUTES
    });
  } catch (err) {
    console.error("❌ create-hold error:", err);
    res.status(500).json({ success: false, message: "Server error creating your hold. Please try again." });
  }
});

// =====================================================================
// STEP 2 — Guest submits proof of the GCash/Maya downpayment.
// This records the claim and moves the booking into the normal admin
// approval queue as "pending" with payment_status = 'pending_verification'.
// It does NOT confirm the money actually arrived — see the note at the
// top of this file.
// =====================================================================
router.post("/api/submit-payment", safeUploadSingle("receipt"), async (req, res) => {
  try {
    const body = req.body || {};
    const { bookingId, paymentMethod, referenceNumber } = body;

    if (!bookingId || !paymentMethod || !referenceNumber) {
      return res.status(400).json({ success: false, message: "Missing payment details." });
    }
    if (!['gcash', 'maya'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: "Invalid payment method." });
    }
    const ref = referenceNumber.trim();
    if (ref.length < 6) {
      return res.status(400).json({ success: false, message: "That reference number looks too short. Please double-check your receipt." });
    }

    const rows = await dbQuery("SELECT * FROM bookings WHERE id = ? LIMIT 1", [bookingId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Booking hold not found. Please start over." });
    }
    const booking = rows[0];

    if (booking.status !== 'pending_payment') {
      return res.status(400).json({ success: false, message: "This booking is no longer awaiting payment." });
    }
    if (new Date(booking.hold_expires_at) < new Date()) {
      await dbQuery("DELETE FROM bookings WHERE id = ?", [bookingId]);
      return res.status(410).json({ success: false, message: "Your reserved slot expired. Please book again." });
    }

    // Block an exact reference number reused on another booking
    const dupe = await dbQuery(
      "SELECT id FROM bookings WHERE reference_number = ? AND id != ? LIMIT 1",
      [ref, bookingId]
    );
    if (dupe.length > 0) {
      return res.status(409).json({ success: false, message: "This reference number is already on file for another booking. If that's a mistake, please contact us directly." });
    }

    const receiptPath = req.file
      ? process.env.VERCEL
        ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
        : `/uploads/receipts/${req.file.filename}`
      : null;

    await dbQuery(
      `UPDATE bookings
       SET status = 'pending',
           payment_method = ?,
           reference_number = ?,
           receipt_image = ?,
           payment_status = 'pending_verification',
           payment_submitted_at = NOW(),
           hold_expires_at = NULL
       WHERE id = ?`,
      [paymentMethod, ref, receiptPath, bookingId]
    );

    // One-time use — clear the email verification code now that the
    // booking is actually finalized.
    if (req.session.verificationCodes) {
      delete req.session.verificationCodes[booking.email];
    }

    res.json({ success: true, message: "Payment submitted! Your booking is now waiting for admin approval." });
  } catch (err) {
    console.error("❌ submit-payment error:", err);
    res.status(500).json({ success: false, message: "Server error submitting your payment. Please try again." });
  }
});

// =====================================================================
// Guest cancels their own hold before paying — frees the slot right
// away instead of making the next guest wait for the 30-min expiry.
// =====================================================================
router.delete("/api/cancel-hold/:id", async (req, res) => {
  try {
    await dbQuery("DELETE FROM bookings WHERE id = ? AND status = 'pending_payment'", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ cancel-hold error:", err);
    res.status(500).json({ success: false, message: "Failed to release your hold." });
  }
});

// =====================================================================
// Admin: mark a payment as verified after checking their own GCash/Maya
// app. This is the actual "did the money arrive" check — done by a
// human, because a manual QR code has no API to ask.
// =====================================================================
router.post("/api/verify-payment/:id", async (req, res) => {
  if (!req.session.isLoggedIn) return res.status(401).json({ success: false, message: "Not authorized." });
  try {
    await dbQuery("UPDATE bookings SET payment_status = 'verified' WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ verify-payment error:", err);
    res.status(500).json({ success: false, message: "Failed to update payment status." });
  }
});

// =====================================================================
// EXTRA #1 — Auto-expire unpaid holds (status = 'pending_payment' older
// than 30 minutes). This is kept for an external cron (e.g.
// cron-job.org) as a belt-and-suspenders sweep, but is no longer the
// only thing standing between an expired hold and a false "already
// booked" error — see cleanupExpiredHolds() above, which now also
// runs inline before every new hold attempt.
// =====================================================================
router.all("/api/cleanup-expired-holds", async (req, res) => {
  try {
    const result = await dbQuery(
      `DELETE FROM bookings WHERE status = 'pending_payment' AND hold_expires_at < NOW()`
    );
    console.log(`🧹 Cleanup: removed ${result.affectedRows} expired unpaid hold(s).`);
    res.json({ success: true, removed: result.affectedRows });
  } catch (err) {
    console.error("❌ cleanup-expired-holds error:", err);
    res.status(500).json({ success: false, message: "Cleanup failed." });
  }
});

module.exports = router;