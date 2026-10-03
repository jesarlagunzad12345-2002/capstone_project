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

function addAdminNotification(req, type, title, message) {
  const notifications = Array.isArray(req.session.adminNotifications)
    ? req.session.adminNotifications
    : [];
  notifications.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    title,
    message,
    createdAt: new Date().toISOString(),
    read: false
  });
  req.session.adminNotifications = notifications.slice(0, 30);
}

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

function getDateOnly(value) {
  return typeof value === 'string' ? value.split(/[ T]/)[0] : formatDateForInput(value);
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
  const triggerPaid = req.session.triggerPaid || false;
  const successMsg = req.session.msg || null;
  
  const errorMsg = req.session.error || null;
  const notifications = Array.isArray(req.session.adminNotifications)
    ? req.session.adminNotifications
    : [];
  const unreadNotificationCount = notifications.filter(notification => !notification.read).length;
  
  const gData = {
    name: req.session.guestName || null,
    email: req.session.guestEmail || null,
    room: req.session.guestRoom || null,
    in: req.session.guestIn || null,
    out: req.session.guestOut || null,
    people: req.session.guestPeople || null,
    requests: req.session.guestRequests || null,
    // FIX: carry the price breakdown through too, so the approval
    // email can show what was paid as downpayment vs. what's still
    // owed (paid walk-in at check-in).
    totalPrice: req.session.guestTotalPrice || null,
    downpayment: req.session.guestDownpayment || null
  };

  const cData = {
    email: req.session.cancelGuestEmail || null,
    name: req.session.cancelGuestName || null,
    room: req.session.cancelGuestRoom || null,
    checkin: req.session.cancelGuestCheckin || null,
    id: req.session.cancelGuestId || null,
    downpayment: req.session.cancelGuestDownpayment || null
  };

  const pData = {
    email: req.session.paidGuestEmail || null,
    name: req.session.paidGuestName || null,
    room: req.session.paidGuestRoom || null,
    checkin: req.session.paidGuestCheckin || null,
    total: req.session.paidGuestTotal || null,
    downpayment: req.session.paidGuestDownpayment || 0,
    amountPaid: req.session.paidGuestAmountPaid || 0,
    balance: req.session.paidGuestBalance || 0
  };

  ['triggerApprove', 'guestName', 'guestEmail', 'guestRoom', 'guestIn', 'guestOut', 
   'guestPeople', 'guestRequests', 'guestTotalPrice', 'guestDownpayment', 'error', 'triggerCancel',
  'cancelGuestEmail', 'cancelGuestName', 'cancelGuestRoom', 'cancelGuestCheckin', 'cancelGuestId',
  'cancelGuestDownpayment', 'triggerPaid', 'paidGuestEmail', 'paidGuestName', 'paidGuestRoom',
  'paidGuestCheckin', 'paidGuestTotal', 'paidGuestDownpayment', 'paidGuestAmountPaid', 'paidGuestBalance', 'msg']
   .forEach(key => delete req.session[key]);

  try {
    const [bookings, rooms, allRooms] = await Promise.all([
      dbQuery("SELECT * FROM bookings ORDER BY id DESC"),
      dbQuery("SELECT * FROM rooms WHERE status = 'available' ORDER BY category, name"),
      dbQuery("SELECT * FROM rooms ORDER BY category, name")
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
      allRooms: allRooms || [],
      notifications,
      unreadNotificationCount,
      triggerApprove, 
      guestName: gData.name, 
      guestEmail: gData.email,
      guestRoom: gData.room, 
      guestIn: gData.in, 
      guestOut: gData.out, 
      guestPeople: gData.people,
      guestRequests: gData.requests,
      guestTotalPrice: gData.totalPrice,
      guestDownpayment: gData.downpayment,
      error: errorMsg,
      message: successMsg,
      triggerCancel,
      triggerPaid,
      paidGuestEmail: pData.email,
      paidGuestName: pData.name,
      paidGuestRoom: pData.room,
      paidGuestCheckin: pData.checkin,
      paidGuestTotal: pData.total,
      paidGuestDownpayment: pData.downpayment,
      paidGuestAmountPaid: pData.amountPaid,
      paidGuestBalance: pData.balance,
      cancelGuestEmail: cData.email,
      cancelGuestName: cData.name,
      cancelGuestRoom: cData.room,
      cancelGuestCheckin: cData.checkin,
      cancelGuestId: cData.id,
      cancelGuestDownpayment: cData.downpayment
    });
  } catch (err) {
    console.error("❌ SQL Error in /bookings:", err);
    res.status(500).send(`<h2>Database Error</h2><p>${err.message || 'Unknown error'}</p><a href="/admin-dashboard">← Back to Dashboard</a>`);
  }
});

router.post("/notifications/read", checkAuth, (req, res) => {
  req.session.adminNotifications = (Array.isArray(req.session.adminNotifications)
    ? req.session.adminNotifications
    : []).map(notification => ({ ...notification, read: true }));
  res.json({ success: true });
});

router.post("/notifications/:id/delete", checkAuth, (req, res) => {
  const notifications = Array.isArray(req.session.adminNotifications)
    ? req.session.adminNotifications
    : [];
  const notificationExists = notifications.some(notification => notification.id === req.params.id);
  if (!notificationExists) return res.status(404).json({ success: false });

  req.session.adminNotifications = notifications.filter(notification => notification.id !== req.params.id);
  res.json({
    success: true,
    unreadCount: req.session.adminNotifications.filter(notification => !notification.read).length
  });
});

// ===================== WALK-IN BOOKING CRUD =====================
router.get("/walk-in-booking", checkAuth, async (req, res) => {
  try {
    const rooms = await dbQuery("SELECT * FROM rooms WHERE status = 'available' ORDER BY category, name");
    res.render("admin/walk-in-booking", { rooms: rooms || [], booking: null, error: req.session.error || null });
    delete req.session.error;
  } catch (err) {
    console.error("❌ Error loading walk-in booking form:", err);
    res.status(500).send("Unable to load the walk-in booking form.");
  }
});

router.get("/walk-in-booking/edit/:id", checkAuth, async (req, res) => {
  try {
    const [bookingRows, rooms] = await Promise.all([
      dbQuery("SELECT * FROM bookings WHERE id = ? AND bookingSource = 'WALK_IN' LIMIT 1", [req.params.id]),
      dbQuery("SELECT * FROM rooms WHERE status = 'available' ORDER BY category, name")
    ]);
    if (bookingRows.length === 0) return res.redirect("/bookings");
    const error = req.session.error || null;
    delete req.session.error;
    res.render("admin/walk-in-booking", { rooms: rooms || [], booking: bookingRows[0], error });
  } catch (err) {
    console.error("❌ Error loading walk-in edit form:", err);
    res.status(500).send("Unable to load the walk-in booking.");
  }
});

router.post("/walk-in-booking", checkAuth, async (req, res) => {
  const { name, email, people, checkin, checkout, roomType, payment_method, amount_paid, requests } = req.body || {};

  try {
    if (!name || !checkin || !checkout || !roomType) {
      req.session.error = "Please complete the guest, date, and accommodation fields.";
      return res.redirect("/walk-in-booking");
    }

    const roomInfo = await dbQuery("SELECT price, category, occupancy FROM rooms WHERE name = ? LIMIT 1", [roomType]);
    if (roomInfo.length === 0) {
      req.session.error = "Selected accommodation was not found.";
      return res.redirect("/walk-in-booking");
    }

    const isCottage = roomInfo[0].category === 'Cottage';
    const checkinDate = getDateOnly(checkin);
    const checkoutDate = getDateOnly(checkout);
    if (isMondayOrTuesday(checkinDate)) {
      req.session.error = "Check-in cannot be on Monday or Tuesday. We are closed those days.";
      return res.redirect("/walk-in-booking");
    }
    if (new Date(checkout) <= new Date(checkin)) {
      req.session.error = "Check-out must be later than check-in.";
      return res.redirect("/walk-in-booking");
    }

    const overlapSql = isCottage
      ? "SELECT id FROM bookings WHERE roomType = ? AND DATE(checkin) = DATE(?) LIMIT 1"
      : "SELECT id FROM bookings WHERE roomType = ? AND checkin < ? AND checkout > ? LIMIT 1";
    const overlapParams = isCottage ? [roomType, checkin] : [roomType, checkoutDate, checkinDate];
    if ((await dbQuery(overlapSql, overlapParams)).length > 0) {
      req.session.error = `"${roomType}" is already booked for those dates.`;
      return res.redirect("/walk-in-booking");
    }

    const calc = await calculateBookingPrice(roomType, checkin, checkout);
    const guestCount = Math.min(Math.max(parseInt(people, 10) || 1, 1), calc.maxOccupancy);
    const total = Number(calc.totalPrice) || 0;
    const paid = Math.min(Math.max(parseFloat(amount_paid) || 0, 0), total);
    const balance = Math.max(0, total - paid);

    const result = await dbQuery(
      `INSERT INTO bookings
       (name, email, people, checkin, checkout, roomType, requests, status,
        total_price, nights, bookingSource, payment_method, amount_paid, balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, 'WALK_IN', ?, ?, ?)`,
      [name, email || 'walkin@kmlresort.local', guestCount, checkin, checkout,
       roomType, requests || null, total, isCottage ? 0 : calc.nights,
       payment_method || 'cash', paid, balance]
    );

    const indexRouter = require("./index");
    await indexRouter.addRevenueForBooking(result.insertId);
    addAdminNotification(
      req,
      'walkin',
      'Walk-in booking created',
      `${name} · ${roomType} · ${formatDateForInput(checkin)}`
    );
    req.session.msg = "Walk-in booking created successfully.";
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Walk-in booking error:", err);
    req.session.error = "Could not create the walk-in booking. Please try again.";
    res.redirect("/walk-in-booking");
  }
});


// ===================== POST: Approve Booking =====================
router.post("/approve/:id", checkAuth, async (req, res) => {
  const bookingId = req.params.id;

  try {
    const bookingRows = await dbQuery("SELECT * FROM bookings WHERE id = ? LIMIT 1", [bookingId]);
    if (bookingRows.length === 0) return res.redirect("/bookings");

    const row = bookingRows[0];
    if (row.reference_number && row.payment_status !== 'verified') {
      req.session.error = "Payment must be verified before this booking can be approved.";
      return res.redirect("/bookings");
    }

    await dbQuery("UPDATE bookings SET status = 'approved' WHERE id = ?", [bookingId]);

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
    // FIX: pass the price breakdown through session so the admin
    // page's confirmation email can show downpayment paid vs.
    // remaining balance due at check-in.
    req.session.guestTotalPrice = row.total_price || 0;
    req.session.guestDownpayment = row.downpayment_amount || 0;
    addAdminNotification(
      req,
      'approved',
      'Booking approved',
      `${row.name} · ${row.roomType} · ${formatDateForInput(row.checkin)}`
    );

    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Approve Error:", err);
    res.status(500).send("Update failed: " + (err.message || "Unknown error"));
  }
});


// ===================== POST: Edit Booking =====================
router.post("/update/:id", checkAuth, async (req, res) => {
  const bookingId = req.params.id;
  const { name, email, people, checkin, checkout, roomType, requests, payment_method, amount_paid, downpayment_amount, payment_status, reference_number } = req.body;
  let isWalkInBooking = false;
  
  try {
    const existingRows = await dbQuery("SELECT bookingSource, total_price, amount_paid, downpayment_amount, payment_status, payment_method, reference_number FROM bookings WHERE id = ? LIMIT 1", [bookingId]);
    const existingBooking = existingRows[0];
    if (!existingBooking) return res.redirect("/bookings");
    isWalkInBooking = existingBooking.bookingSource === 'WALK_IN';
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

    let amountPaidForUpdate = 0;
    if (isWalkInBooking) {
      const total = Number(calc.totalPrice) || 0;
      const amountPaid = amount_paid === undefined || amount_paid === ''
        ? Number(existingBooking.amount_paid) || 0
        : Number(amount_paid);
      if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > total) {
        const formatPeso = value => '₱' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        req.session.error = `Amount paid must be between ₱0.00 and ${formatPeso(total)}.`;
        return res.redirect(`/walk-in-booking/edit/${bookingId}`);
      }
      amountPaidForUpdate = amountPaid;
    }

    let paymentUpdate = null;
    if (existingBooking && existingBooking.bookingSource !== 'WALK_IN' && payment_status !== undefined) {
      const validPaymentMethods = ['gcash', 'maya', 'cash', 'card'];
      const validPaymentStatuses = ['pending_verification', 'verified'];
      const normalizedMethod = String(payment_method || '').toLowerCase();
      const normalizedStatus = String(payment_status || '');
      const reference = String(reference_number || '').trim();
      const requestedDownpayment = Number(downpayment_amount);

      if (!validPaymentMethods.includes(normalizedMethod) || !validPaymentStatuses.includes(normalizedStatus) || !reference || !Number.isFinite(requestedDownpayment) || requestedDownpayment < 0) {
        req.session.error = "Please provide valid downpayment details and payment status.";
        return res.redirect("/bookings");
      }

      const duplicateReference = await dbQuery(
        "SELECT id FROM bookings WHERE reference_number = ? AND id != ? LIMIT 1",
        [reference, bookingId]
      );
      if (duplicateReference.length > 0) {
        req.session.error = "That payment reference number is already assigned to another booking.";
        return res.redirect("/bookings");
      }

      paymentUpdate = {
        method: normalizedMethod,
        status: normalizedStatus,
        reference,
        downpayment: Math.min(requestedDownpayment, Number(calc.totalPrice) || 0)
      };
    }
    
    await dbQuery(
      `UPDATE bookings 
       SET name = ?, email = ?, people = ?, checkin = ?, checkout = ?, 
           roomType = ?, requests = ?, total_price = ?, nights = ? 
       WHERE id = ?`,
      [name, email, guestCount, finalCheckin, finalCheckout, roomType, requests || null, calc.totalPrice, calc.nights, bookingId]
    );

    if (existingBooking && existingBooking.bookingSource === 'WALK_IN') {
      await dbQuery(
        "UPDATE bookings SET payment_method = ?, amount_paid = ?, balance = ? WHERE id = ?",
        [payment_method || 'cash', amountPaidForUpdate, Math.max(0, Number(calc.totalPrice) - amountPaidForUpdate), bookingId]
      );
    } else if (paymentUpdate) {
      const total = Number(calc.totalPrice) || 0;
      const paidSoFar = Math.min(
        Math.max(Number(existingBooking.amount_paid) || 0, paymentUpdate.downpayment),
        total
      );
      await dbQuery(
        "UPDATE bookings SET payment_method = ?, reference_number = ?, downpayment_amount = ?, payment_status = ?, balance = ? WHERE id = ?",
        [paymentUpdate.method, paymentUpdate.reference, paymentUpdate.downpayment, paymentUpdate.status, Math.max(0, total - paidSoFar), bookingId]
      );
    }

    console.log(`✅ Booking #${bookingId} updated. New total: ₱${calc.totalPrice} for ${calc.nights} night(s) in ${calc.roomCategory}`);
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Update Error:", err);
    if (isWalkInBooking) {
      req.session.error = "Could not update this walk-in booking. Please check the payment amount and try again.";
      return res.redirect(`/walk-in-booking/edit/${bookingId}`);
    }
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

// ===================== POST: Mark Booking Fully Paid =====================
router.post("/mark-paid/:id", checkAuth, async (req, res) => {
  try {
    const rows = await dbQuery("SELECT * FROM bookings WHERE id = ? LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.redirect("/bookings");

    const booking = rows[0];
    const total = Number(booking.total_price) || 0;
    const downpayment = Math.min(Math.max(Number(booking.downpayment_amount) || 0, 0), total);
    const previouslyPaid = Math.min(Math.max(Number(booking.amount_paid) || 0, downpayment), total);
    const amountPaidNow = Math.max(0, total - previouslyPaid);
    await dbQuery(
      "UPDATE bookings SET amount_paid = ?, balance = 0, payment_status = 'verified' WHERE id = ?",
      [total, booking.id]
    );

    req.session.triggerPaid = true;
    req.session.paidGuestEmail = booking.email;
    req.session.paidGuestName = booking.name;
    req.session.paidGuestRoom = booking.roomType;
    req.session.paidGuestCheckin = formatDateForInput(booking.checkin);
    req.session.paidGuestTotal = total;
    req.session.paidGuestDownpayment = downpayment;
    req.session.paidGuestAmountPaid = amountPaidNow;
    req.session.paidGuestBalance = 0;
    addAdminNotification(
      req,
      'paid',
      'Payment fully paid',
      `${booking.name} · ${booking.roomType} · ₱${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    );
    req.session.msg = "Booking marked as fully paid.";
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Mark paid error:", err);
    res.status(500).send("Could not mark booking as fully paid: " + (err.message || "Unknown error"));
  }
});


// ===================== POST: Admin Cancel Approved Booking =====================
router.post("/admin-cancel/:id", checkAuth, async (req, res) => {
  try {
    const rows = await dbQuery("SELECT * FROM bookings WHERE id = ?", [req.params.id]);

    const booking = rows[0];
    await dbQuery("DELETE FROM bookings WHERE id = ?", [req.params.id]);

    if (booking) {
      req.session.triggerCancel = true;
      req.session.cancelGuestEmail = booking.email;
      req.session.cancelGuestName = booking.name;
      req.session.cancelGuestRoom = booking.roomType;
      req.session.cancelGuestCheckin = formatDateForInput(booking.checkin);
      req.session.cancelGuestId = booking.id;
      // FIX: carry the downpayment amount through too, so the
      // cancellation email can clearly show the guest exactly how
      // much was forfeited (downpayments are non-refundable).
      req.session.cancelGuestDownpayment = booking.downpayment_amount || 0;
      addAdminNotification(
        req,
        'cancelled',
        'Booking cancelled',
        `${booking.name} · ${booking.roomType} · ${formatDateForInput(booking.checkin)}`
      );
    }
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
        status: booking.status || 'pending',
        // FIX: the guest-facing cancel form needs this to show/email
        // the guest exactly how much downpayment is being forfeited.
        downpaymentAmount: booking.downpayment_amount || 0
      });
    }
    
    if (booking.status !== 'approved') {
      await dbQuery("DELETE FROM bookings WHERE id = ?", [booking.id]);
      console.log(`✅ Guest cancelled pending booking #${booking.id} for ${email}`);
      return res.json({ 
        success: true, 
        bookingId: booking.id,
        roomType: booking.roomType || 'Standard',
        downpaymentAmount: booking.downpayment_amount || 0,
        message: "Your pending booking has been cancelled successfully." 
      });
    } else {
      console.log(`📧 Cancellation request received for approved booking #${booking.id} by ${email}`);
      return res.json({ 
        success: true, 
        bookingId: booking.id,
        roomType: booking.roomType || 'Standard',
        downpaymentAmount: booking.downpayment_amount || 0,
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