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

async function calculateBookingPrice(roomType, checkin, checkout) {
    try {
        // Get room price from database
        const roomResults = await dbQuery(
            "SELECT price, category, occupancy FROM rooms WHERE name = ? LIMIT 1", 
            [roomType]
        );
        
        const roomPrice = roomResults.length > 0 ? parseFloat(roomResults[0].price) : 0;
        const roomCategory = roomResults.length > 0 ? roomResults[0].category : 'Room';
        const maxOccupancy = roomResults.length > 0 ? parseInt(roomResults[0].occupancy) : 1;
        
        // Calculate nights
        const checkinDate = new Date(checkin);
        const checkoutDate = new Date(checkout);
        const timeDiff = checkoutDate - checkinDate;
        const nights = Math.max(1, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
        
        // Calculate total price
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
  
  // NEW: Read error message from session (for double-booking conflicts on edit)
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

  // Clear all session keys after reading them
  ['triggerApprove', 'guestName', 'guestEmail', 'guestRoom', 'guestIn', 'guestOut', 'guestPeople', 'guestRequests', 'error'].forEach(key => delete req.session[key]);

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
      error: errorMsg  // NEW: pass error to EJS template
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


// ===================== UPDATED: POST: Edit Booking with double-booking check =====================
router.post("/update/:id", checkAuth, async (req, res) => {
  const bookingId = req.params.id;
  const { name, email, people, checkin, checkout, roomType, requests } = req.body;
  
  try {
    // NEW: Check for double booking BEFORE saving edits
    // id != ? makes sure we don't count the booking we're currently editing
    const overlapCheck = await dbQuery(`
      SELECT checkin, checkout 
      FROM bookings 
      WHERE roomType = ? 
        AND status = 'approved'
        AND id != ?
        AND checkin < ? 
        AND checkout > ?
      LIMIT 1
    `, [roomType, bookingId, checkout, checkin]);

    if (overlapCheck.length > 0) {
      const existing = overlapCheck[0];
      const inStr = new Date(existing.checkin).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const outStr = new Date(existing.checkout).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      
      req.session.error = `"${roomType}" is already booked from ${inStr} to ${outStr}. Please choose another room/cottage or different dates.`;
      return res.redirect("/bookings");
    }

    const calc = await calculateBookingPrice(roomType, checkin, checkout);
    let guestCount = parseInt(people) || 1;
    if (guestCount > calc.maxOccupancy && calc.maxOccupancy > 0) {
        guestCount = calc.maxOccupancy;
    }
    
    await dbQuery(
      `UPDATE bookings 
       SET name = ?, email = ?, people = ?, checkin = ?, checkout = ?, 
           roomType = ?, requests = ?, total_price = ?, nights = ? 
       WHERE id = ?`,
      [name, email, guestCount, checkin, checkout, roomType, requests || null, calc.totalPrice, calc.nights, bookingId]
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

module.exports = router;