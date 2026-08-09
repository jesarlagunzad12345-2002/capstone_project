const express = require("express");
const router = express.Router();
const db = require("../config/database");

const checkAuth = (req, res, next) => {
  if (req.session.isLoggedIn) {
    next();
  } else {
    res.redirect("/login");
  }
};

const dbQuery = (sql, params = []) => new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => err ? reject(err) : resolve(results));
});

function formatDateForInput(dateValue) {
    if (!dateValue) return '';
    
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return dateValue;
    }
    
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return '';
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

// ===================== HELPER: Block Monday & Tuesday =====================
function isMondayOrTuesday(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    return dayOfWeek === 1 || dayOfWeek === 2; // 1=Mon, 2=Tue
}

// ===================== HELPER: Auto-checkout for rooms =====================
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

// ===================== HELPER: Generate 6-digit verification code =====================
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ===================== UPDATED: Cottage day-use support =====================
async function calculateBookingPrice(roomType, checkin, checkout, bookingDate, checkinTime, checkoutTime) {
    try {
        const roomResults = await dbQuery(
            "SELECT price, category, occupancy FROM rooms WHERE name = ? LIMIT 1", 
            [roomType]
        );
        
        const roomPrice = roomResults.length > 0 ? parseFloat(roomResults[0].price) : 0;
        const roomCategory = roomResults.length > 0 ? roomResults[0].category : 'Room';
        const maxOccupancy = roomResults.length > 0 ? parseInt(roomResults[0].occupancy) : 1;
        
        if (roomCategory === 'Cottage') {
            // Cottage: flat rate, no nights
            return {
                roomPrice,
                roomCategory,
                maxOccupancy,
                nights: 0,
                totalPrice: roomPrice
            };
        }
        
        // Room: per night calculation
        const checkinDate = new Date(checkin);
        const checkoutDate = new Date(checkout);
        const timeDiff = checkoutDate - checkinDate;
        const nights = Math.max(1, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
        
        const totalPrice = roomPrice * nights;
        
        return {
            roomPrice,
            roomCategory,
            maxOccupancy,
            nights,
            totalPrice
        };
    } catch (err) {
        console.error("❌ Error calculating booking price:", err);
        return {
            roomPrice: 0,
            roomCategory: 'Room',
            maxOccupancy: 1,
            nights: 1,
            totalPrice: 0
        };
    }
}


// ===================== GET: Admin Bookings Page =====================
router.get("/bookings", checkAuth, async (req, res) => {
  const triggerApprove = req.session.triggerApprove || false;
  const triggerCancel = req.session.triggerCancel || false;
  
  const errorMsg = req.session.error || null;
  
  const gData = {
    name: req.session.guestName || null,
    email: req.session.guestEmail || null,
    room: req.session.guestRoom || null,
    in: req.session.guestIn || null,
    out: req.session.guestOut || null,
    people: req.session.guestPeople || null,
    requests: req.session.guestRequests || null
  };

  const cData = {
    email: req.session.cancelGuestEmail || null,
    name: req.session.cancelGuestName || null,
    room: req.session.cancelGuestRoom || null,
    checkin: req.session.cancelGuestCheckin || null,
    id: req.session.cancelGuestId || null
  };

  ['triggerApprove', 'guestName', 'guestEmail', 'guestRoom', 'guestIn', 'guestOut', 
   'guestPeople', 'guestRequests', 'error', 'triggerCancel', 'cancelGuestEmail', 
   'cancelGuestName', 'cancelGuestRoom', 'cancelGuestCheckin', 'cancelGuestId']
   .forEach(key => delete req.session[key]);

  try {
    const [bookings, rooms] = await Promise.all([
      dbQuery("SELECT * FROM bookings ORDER BY id DESC"),
      dbQuery("SELECT * FROM rooms WHERE status = 'available' ORDER BY category, name")
    ]);
    
    const formattedBookings = bookings.map(booking => {
        return {
            ...booking,
            checkinFormatted: formatDateForInput(booking.checkin),
            checkoutFormatted: formatDateForInput(booking.checkout)
        };
    });
    
    res.render("admin/booking", { 
      bookings: formattedBookings || [],
      rooms: rooms || [],
      triggerApprove, 
      guestName: gData.name, 
      guestEmail: gData.email,
      guestRoom: gData.room, 
      guestIn: gData.in, 
      guestOut: gData.out, 
      guestPeople: gData.people,
      guestRequests: gData.requests,
      error: errorMsg,
      triggerCancel,
      cancelGuestEmail: cData.email,
      cancelGuestName: cData.name,
      cancelGuestRoom: cData.room,
      cancelGuestCheckin: cData.checkin,
      cancelGuestId: cData.id
    });
  } catch (err) {
    console.error("❌ SQL Error in /bookings:", err);
    res.status(500).send(`<h2>Database Error</h2><p>${err.message || 'Unknown error'}</p><a href="/admin-dashboard">← Back to Dashboard</a>`);
  }
});


// ===================== POST: Approve Booking =====================
router.post("/approve/:id", checkAuth, async (req, res) => {
  const bookingId = req.params.id;

  try {
    await dbQuery("UPDATE bookings SET status = 'approved' WHERE id = ?", [bookingId]);

    const rows = await dbQuery("SELECT * FROM bookings WHERE id = ?", [bookingId]);

    if (rows && rows.length > 0) {
      const row = rows[0];

      const indexRouter = require("./index");
      await indexRouter.addRevenueForBooking(bookingId);

      const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
      req.session.triggerApprove = true;
      req.session.guestName = row.name;
      req.session.guestEmail = row.email;
      req.session.guestRoom = row.roomType;
      req.session.guestPeople = row.people;
      req.session.guestRequests = row.requests || "None";
      req.session.guestIn = new Date(row.checkin).toLocaleDateString('en-US', dateOptions);
      req.session.guestOut = new Date(row.checkout).toLocaleDateString('en-US', dateOptions);
    }

    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Approve Error:", err);
    res.status(500).send("Update failed: " + (err.message || "Unknown error"));
  }
});


// ===================== POST: Edit Booking =====================
router.post("/update/:id", checkAuth, async (req, res) => {
  const bookingId = req.params.id;
  const { name, email, people, checkin, checkout, roomType, requests } = req.body;
  
  try {
    // Get room category
    const roomInfo = await dbQuery("SELECT category, occupancy FROM rooms WHERE name = ? LIMIT 1", [roomType]);
    const roomCategory = roomInfo.length > 0 ? roomInfo[0].category : 'Room';
    const isCottage = (roomCategory === 'Cottage');

    let finalCheckin = checkin;
    let finalCheckout = checkout;

    if (!isCottage) {
      // BLOCK MONDAY & TUESDAY
      if (isMondayOrTuesday(checkin)) {
        req.session.error = "Check-in cannot be on Monday or Tuesday. We are closed those days.";
        return res.redirect("/bookings");
      }
      
      // Auto-calculate checkout for rooms (next day, skip Mon/Tue)
      finalCheckout = getAutoCheckout(checkin);

      // Room: check date overlap against ALL bookings (pending + approved)
      const overlapCheck = await dbQuery(`
        SELECT checkin, checkout 
        FROM bookings 
        WHERE roomType = ? 
          AND id != ?
          AND checkin < ? 
          AND checkout > ?
        LIMIT 1
      `, [roomType, bookingId, finalCheckout, finalCheckin]);

      if (overlapCheck.length > 0) {
        const existing = overlapCheck[0];
        const inStr = new Date(existing.checkin).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const outStr = new Date(existing.checkout).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        
        req.session.error = `"${roomType}" is already booked from ${inStr} to ${outStr}. Please choose another room/cottage or different dates.`;
        return res.redirect("/bookings");
      }
    } else {
      // Cottage: extract date from checkin datetime string
      const cottageDate = checkin.split(' ')[0];

      // BLOCK MONDAY & TUESDAY
      if (isMondayOrTuesday(cottageDate)) {
        req.session.error = "We are closed every Monday and Tuesday. Please choose a different date.";
        return res.redirect("/bookings");
      }

      // Cottage: check same-day overlap against ALL bookings (pending + approved)
      const overlapCheck = await dbQuery(`
        SELECT checkin 
        FROM bookings 
        WHERE roomType = ? 
          AND id != ?
          AND DATE(checkin) = DATE(?)
        LIMIT 1
      `, [roomType, bookingId, checkin]);

      if (overlapCheck.length > 0) {
        const dateStr = new Date(checkin).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        req.session.error = `"${roomType}" is already booked on ${dateStr}. Please choose another cottage or a different date.`;
        return res.redirect("/bookings");
      }
    }

    const calc = await calculateBookingPrice(roomType, finalCheckin, finalCheckout);
    let guestCount = parseInt(people) || 1;
    if (guestCount > calc.maxOccupancy && calc.maxOccupancy > 0) {
        guestCount = calc.maxOccupancy;
    }
    
    await dbQuery(
      `UPDATE bookings 
       SET name = ?, email = ?, people = ?, checkin = ?, checkout = ?, 
           roomType = ?, requests = ?, total_price = ?, nights = ? 
       WHERE id = ?`,
      [name, email, guestCount, finalCheckin, finalCheckout, roomType, requests || null, calc.totalPrice, calc.nights, bookingId]
    );

    console.log(`✅ Booking #${bookingId} updated. New total: ₱${calc.totalPrice} for ${calc.nights} night(s) in ${calc.roomCategory}`);
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Update Error:", err);
    res.status(500).send("Update failed: " + (err.message || "Unknown error"));
  }
});


// ===================== POST: Delete Booking =====================
router.post("/delete/:id", checkAuth, async (req, res) => {
  try {
    await dbQuery("DELETE FROM bookings WHERE id = ?", [req.params.id]);
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Delete Error:", err);
    res.status(500).send("Delete failed: " + (err.message || "Unknown error"));
  }
});


// ===================== POST: Admin Cancel Approved Booking =====================
router.post("/admin-cancel/:id", checkAuth, async (req, res) => {
  try {
    const rows = await dbQuery("SELECT * FROM bookings WHERE id = ?", [req.params.id]);
    
    if (rows.length > 0) {
      const booking = rows[0];
      
      req.session.triggerCancel = true;
      req.session.cancelGuestEmail = booking.email;
      req.session.cancelGuestName = booking.name;
      req.session.cancelGuestRoom = booking.roomType;
      req.session.cancelGuestCheckin = formatDateForInput(booking.checkin);
      req.session.cancelGuestId = booking.id;
    }
    
    await dbQuery("DELETE FROM bookings WHERE id = ?", [req.params.id]);
    console.log(`✅ Admin cancelled approved booking #${req.params.id}`);
    
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Admin Cancel Error:", err);
    res.status(500).send("Cancel failed: " + (err.message || "Unknown error"));
  }
});


// ===================== POST: Guest Cancel Booking =====================
router.post("/cancel-booking", async (req, res) => {
  const { email, checkin, verifyOnly } = req.body;
  
  if (!email || !checkin) {
    return res.status(400).json({ 
      success: false, 
      message: "Please fill in Email and Check-in Date." 
    });
  }

  try {
    const rows = await dbQuery(
      "SELECT * FROM bookings WHERE email = ? AND DATE(checkin) = ? LIMIT 1", 
      [email, checkin]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "No booking found with this email and check-in date." 
      });
    }
    
    const booking = rows[0];
    
    if (verifyOnly) {
      return res.json({ 
        success: true, 
        bookingId: booking.id,
        roomType: booking.roomType || 'Standard',
        status: booking.status || 'pending'
      });
    }
    
    if (booking.status !== 'approved') {
      await dbQuery("DELETE FROM bookings WHERE id = ?", [booking.id]);
      console.log(`✅ Guest cancelled pending booking #${booking.id} for ${email}`);
      return res.json({ 
        success: true, 
        bookingId: booking.id,
        roomType: booking.roomType || 'Standard',
        message: "Your pending booking has been cancelled successfully." 
      });
    } else {
      console.log(`📧 Cancellation request received for approved booking #${booking.id} by ${email}`);
      return res.json({ 
        success: true, 
        bookingId: booking.id,
        roomType: booking.roomType || 'Standard',
        message: "Your cancellation request has been submitted. Our admin team will contact you shortly." 
      });
    }
    
  } catch (err) {
    console.error("❌ Guest Cancel Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Server error. Please contact us directly." 
    });
  }
});


// ===================== EMAIL VERIFICATION ROUTES =====================

// POST: Request verification code
router.post("/api/request-verification-code", async (req, res) => {
    const { email } = req.body;
    
    if (!email || !email.includes('@')) {
        return res.json({ success: false, message: "Please enter a valid email address." });
    }

    try {
        const code = generateVerificationCode();
        
        // Store code in session with expiry (10 minutes)
        if (!req.session.verificationCodes) {
            req.session.verificationCodes = {};
        }
        
        req.session.verificationCodes[email] = {
            code: code,
            verified: false,
            expires: Date.now() + (10 * 60 * 1000) // 10 minutes from now
        };

        // Return the code so the FRONTEND can send it via EmailJS
        res.json({ 
            success: true, 
            code: code,
            message: "Code generated successfully." 
        });
        
    } catch (err) {
        console.error("❌ Verification Code Error:", err);
        res.json({ success: false, message: "Server error. Please try again." });
    }
});

// POST: Verify the code entered by user
router.post("/api/verify-code", async (req, res) => {
    const { email, code } = req.body;
    
    if (!req.session.verificationCodes || !req.session.verificationCodes[email]) {
        return res.json({ success: false, message: "No verification code found. Please request a new one." });
    }

    const record = req.session.verificationCodes[email];
    
    // Check if expired
    if (Date.now() > record.expires) {
        delete req.session.verificationCodes[email];
        return res.json({ success: false, message: "Code expired. Please request a new one." });
    }

    // Check if code matches
    if (record.code !== code.trim()) {
        return res.json({ success: false, message: "Invalid code. Please try again." });
    }

    // Mark as verified
    record.verified = true;
    res.json({ success: true, message: "Email verified successfully!" });
});


module.exports = router;