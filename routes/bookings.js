const express = require("express");
const router = express.Router();
const db = require("../config/database");
const {
  normalizeBookingAddons,
  getBookingAddons,
  stripCalculatedBookingRequests,
  getOvernightExtraGuestFee,
  getEntranceFee,
  EXTRA_OVERNIGHT_GUEST_PRICE,
  ENTRANCE_FEE_PER_PERSON,
  MAX_BOOKING_GUESTS
} = require("../utils/booking-addons");
const {
  normalizeKtvStartTime,
  withKtvScheduleLock,
  findKtvConflict,
  isMondayOrTuesday: isKtvClosedDay
} = require("../utils/ktv-schedule");

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
    requests: req.session.guestRequests || null
  };
  const guestTotalPrice = Number(req.session.guestTotalPrice) || 0;

  const cData = {
    email: req.session.cancelGuestEmail || null,
    name: req.session.cancelGuestName || null,
    room: req.session.cancelGuestRoom || null,
    checkin: req.session.cancelGuestCheckin || null,
    id: req.session.cancelGuestId || null,
    source: req.session.cancelGuestSource || null
  };

  const paymentPaidData = {
    trigger: req.session.triggerPaymentPaid || false,
    email: req.session.paymentPaidEmail || null,
    name: req.session.paymentPaidName || null,
    id: req.session.paymentPaidId || null,
    room: req.session.paymentPaidRoom || null,
    checkin: req.session.paymentPaidCheckin || null,
    checkout: req.session.paymentPaidCheckout || null,
    total: Number(req.session.paymentPaidTotal) || 0,
    amountPaidToday: Number(req.session.paymentPaidToday) || 0,
    entranceFee: Number(req.session.paymentPaidEntranceFee) || 0,
    poolFee: Number(req.session.paymentPaidPoolFee) || 0,
    ktvFee: Number(req.session.paymentPaidKtvFee) || 0
  };

  ['triggerApprove', 'guestName', 'guestEmail', 'guestRoom', 'guestIn', 'guestOut',
   'triggerPaymentPaid', 'paymentPaidEmail', 'paymentPaidName', 'paymentPaidId',
   'paymentPaidRoom', 'paymentPaidCheckin', 'paymentPaidCheckout', 'paymentPaidTotal',
   'paymentPaidToday', 'paymentPaidEntranceFee', 'paymentPaidPoolFee', 'paymentPaidKtvFee',
   'guestPeople', 'guestRequests', 'error', 'triggerCancel',
  'cancelGuestEmail', 'cancelGuestName', 'cancelGuestRoom', 'cancelGuestCheckin', 'cancelGuestId', 'cancelGuestSource',
  'cancelGuestDownpayment', 'triggerPaid', 'paidGuestEmail', 'paidGuestName', 'paidGuestRoom',
  'paidGuestCheckin', 'paidGuestTotal', 'paidGuestDownpayment', 'paidGuestAmountPaid', 'paidGuestBalance',
  'msg']
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
      getBookingAddons,
      stripCalculatedBookingRequests,
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
      guestTotalPrice,
      error: errorMsg,
      message: successMsg,
      triggerCancel,
      cancelGuestEmail: cData.email,
      cancelGuestName: cData.name,
      cancelGuestRoom: cData.room,
      cancelGuestCheckin: cData.checkin,
      cancelGuestId: cData.id,
      cancelGuestSource: cData.source,
      paymentPaidData
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
    res.render("admin/walk-in-booking", {
      rooms: rooms || [],
      booking: null,
      error: req.session.error || null,
      getBookingAddons,
      stripCalculatedBookingRequests
    });
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
    res.render("admin/walk-in-booking", {
      rooms: rooms || [],
      booking: bookingRows[0],
      error,
      getBookingAddons,
      stripCalculatedBookingRequests
    });
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
    const guestCount = Number(people);
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_BOOKING_GUESTS) {
      req.session.error = `Guest count must be between 1 and ${MAX_BOOKING_GUESTS}.`;
      return res.redirect("/walk-in-booking");
    }
    if (calc.roomCategory === 'Cottage' && guestCount > calc.maxOccupancy) {
      req.session.error = `This cottage can accommodate up to ${calc.maxOccupancy} guests.`;
      return res.redirect("/walk-in-booking");
    }
    const extraGuestCount = calc.roomCategory === 'Cottage' ? 0 : Math.max(0, guestCount - calc.maxOccupancy);
    const extraGuestFee = getOvernightExtraGuestFee(guestCount, calc.maxOccupancy, calc.nights);
    const isCottageBooking = calc.roomCategory === 'Cottage';
    const maxPaidPoolUsers = isCottageBooking ? guestCount : extraGuestCount;
    const addons = normalizeBookingAddons(req.body || {}, guestCount, maxPaidPoolUsers);
    if (addons.error) {
      req.session.error = addons.error;
      return res.redirect("/walk-in-booking");
    }
    const ktvStartTime = addons.ktvSelected ? normalizeKtvStartTime(req.body.ktvStartTime) : null;
    const ktvBookingDate = addons.ktvSelected ? checkinDate : null;
    if (addons.ktvSelected && !ktvStartTime) {
      req.session.error = "Select an available KTV time slot.";
      return res.redirect("/walk-in-booking");
    }
    if (addons.ktvSelected && isKtvClosedDay(ktvBookingDate)) {
      req.session.error = "The KTV is closed on Mondays and Tuesdays. Choose another booking date.";
      return res.redirect("/walk-in-booking");
    }
    const entranceFee = getEntranceFee(guestCount, isCottageBooking);
    const total = (Number(calc.totalPrice) || 0) + addons.price + extraGuestFee + entranceFee;
    const bookingRequests = stripCalculatedBookingRequests(requests);
    const paid = amount_paid === undefined || amount_paid === '' ? 0 : Number(amount_paid);
    if (!Number.isFinite(paid) || paid < 0 || paid > total) {
      req.session.error = `Amount paid must be between ₱0.00 and the total price of ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
      return res.redirect("/walk-in-booking");
    }
    const balance = Math.max(0, total - paid);

    const insertSql = `INSERT INTO bookings
       (name, email, people, checkin, checkout, roomType, requests, status,
        total_price, nights, bookingSource, payment_method, amount_paid, balance,
        pool_addon, pool_adult_count, pool_child_count, pool_fee, ktv_addon, ktv_fee, ktv_guest_count,
        ktv_booking_date, ktv_start_time,
        overnight_extra_guest_count, overnight_extra_guest_rate, overnight_extra_guest_fee,
        entrance_fee_per_person, entrance_fee_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, 'WALK_IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ;
    const insertParams = [name, email || 'walkin@kmlresort.local', guestCount, checkin, checkout,
       roomType, bookingRequests, total, isCottageBooking ? 0 : calc.nights,
       payment_method || 'cash', paid, balance,
       addons.poolSelected ? 1 : 0, addons.poolAdultCount, addons.poolChildCount, addons.poolFee,
       addons.ktvSelected ? 1 : 0, addons.ktvFee, addons.ktvGuestCount, ktvBookingDate, ktvStartTime,
       extraGuestCount, EXTRA_OVERNIGHT_GUEST_PRICE, extraGuestFee,
       isCottageBooking ? ENTRANCE_FEE_PER_PERSON : 0, entranceFee];
    let result;
    if (addons.ktvSelected) {
      const reservation = await withKtvScheduleLock(async connection => {
        const conflict = await findKtvConflict(connection, ktvBookingDate, ktvStartTime);
        if (conflict) return { conflict: true };
        const [insertResult] = await connection.query(insertSql, insertParams);
        return { result: insertResult };
      });
      if (reservation.conflict) {
        req.session.error = "That KTV time slot was just booked. Choose another available time.";
        return res.redirect("/walk-in-booking");
      }
      result = reservation.result;
    } else {
      result = await dbQuery(insertSql, insertParams);
    }

    const indexRouter = require("./index");
    await indexRouter.addRevenueForBooking(result.insertId);
    addAdminNotification(
      req,
      'walkin',
      'Walk-in booking created',
      `${name} · ${roomType} · ${formatDateForInput(checkin)}`
    );
    if (total > 0 && paid >= total) {
      addAdminNotification(
        req,
        'payment',
        'Walk-in booking fully paid',
        `${name} · ${roomType} · ${formatDateForInput(checkin)}`
      );
    }
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
    if (row.payment_status !== 'verified') {
      req.session.error = "Verify the customer's payment before approving this booking.";
      return res.redirect("/bookings");
    }

    const approvalResult = await dbQuery(
      "UPDATE bookings SET status = 'approved' WHERE id = ? AND status <> 'approved' AND payment_status = 'verified'",
      [bookingId]
    );
    if (approvalResult.affectedRows === 0) {
      req.session.error = "This booking could not be approved. Verify payment and try again.";
      return res.redirect("/bookings");
    }

    const indexRouter = require("./index");
    await indexRouter.addRevenueForBooking(bookingId);

    const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    req.session.triggerApprove = true;
    req.session.guestName = row.name;
    req.session.guestEmail = row.email;
    req.session.guestRoom = row.roomType;
    req.session.guestPeople = row.people;
    req.session.guestRequests = stripCalculatedBookingRequests(row.requests) || "None";
    req.session.guestTotalPrice = Number(row.total_price) || 0;
    req.session.guestIn = new Date(row.checkin).toLocaleDateString('en-US', dateOptions);
    req.session.guestOut = new Date(row.checkout).toLocaleDateString('en-US', dateOptions);
    req.session.msg = "Booking approved. Sending the customer confirmation email.";
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
  const { name, email, phone, people, checkin, checkout, roomType, requests, payment_method, payment_status, amount_paid } = req.body;
  let isWalkInBooking = false;
  
  try {
    const existingRows = await dbQuery("SELECT bookingSource, status, amount_paid, total_price, name, roomType, checkin, phone, payment_status, payment_method, ktv_addon, ktv_start_time FROM bookings WHERE id = ? LIMIT 1", [bookingId]);
    const existingBooking = existingRows[0];
    if (!existingBooking) return res.redirect("/bookings");
    isWalkInBooking = existingBooking.bookingSource === 'WALK_IN';
    let paymentStatusForUpdate = existingBooking.payment_status;
    if (!isWalkInBooking) {
      if (existingBooking.status === 'approved') {
        paymentStatusForUpdate = 'verified';
      } else if (payment_status !== undefined) {
        if (!['pending_verification', 'verified'].includes(payment_status)) {
          req.session.error = "Choose a valid payment status.";
          return res.redirect("/bookings");
        }
        paymentStatusForUpdate = payment_status;
      }
    }
    const phoneNumber = phone === undefined ? existingBooking.phone : String(phone).trim();
    if (phoneNumber && phoneNumber.length > 30) {
      req.session.error = "Phone number must be 30 characters or fewer.";
      return res.redirect("/bookings");
    }
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
      
      // Room checkout is the next calendar day, including Monday after a Sunday check-in.
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
    const guestCount = Number(people);
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_BOOKING_GUESTS) {
      req.session.error = `Guest count must be between 1 and ${MAX_BOOKING_GUESTS}.`;
      return res.redirect(isWalkInBooking ? `/walk-in-booking/edit/${bookingId}` : "/bookings");
    }
    if (calc.roomCategory === 'Cottage' && guestCount > calc.maxOccupancy) {
      req.session.error = `This cottage can accommodate up to ${calc.maxOccupancy} guests.`;
      return res.redirect(isWalkInBooking ? `/walk-in-booking/edit/${bookingId}` : "/bookings");
    }
    const extraGuestCount = calc.roomCategory === 'Cottage' ? 0 : Math.max(0, guestCount - calc.maxOccupancy);
    const extraGuestFee = getOvernightExtraGuestFee(guestCount, calc.maxOccupancy, calc.nights);
    const isCottageBooking = calc.roomCategory === 'Cottage';
    const entranceFee = getEntranceFee(guestCount, isCottageBooking);
    const addons = normalizeBookingAddons(req.body, guestCount, isCottageBooking ? guestCount : extraGuestCount);
    if (addons.error) {
      req.session.error = addons.error;
      return res.redirect(isWalkInBooking ? `/walk-in-booking/edit/${bookingId}` : "/bookings");
    }
    const ktvStartTime = addons.ktvSelected
      ? normalizeKtvStartTime(req.body.ktvStartTime || (existingBooking.ktv_addon ? existingBooking.ktv_start_time : null))
      : null;
    const ktvBookingDate = addons.ktvSelected ? String(finalCheckin).slice(0, 10) : null;
    if (addons.ktvSelected && !ktvStartTime) {
      req.session.error = "Select an available KTV time slot before saving this booking.";
      return res.redirect(isWalkInBooking ? `/walk-in-booking/edit/${bookingId}` : "/bookings");
    }
    if (addons.ktvSelected && isKtvClosedDay(ktvBookingDate)) {
      req.session.error = "The KTV is closed on Mondays and Tuesdays. Choose another booking date.";
      return res.redirect(isWalkInBooking ? `/walk-in-booking/edit/${bookingId}` : "/bookings");
    }
    const totalPrice = calc.totalPrice
      + addons.price
      + extraGuestFee
      + entranceFee;
    const bookingRequests = stripCalculatedBookingRequests(requests);

    const total = Number(totalPrice) || 0;
    let amountPaidForUpdate = Number(existingBooking.amount_paid) || 0;
    if (isWalkInBooking && amount_paid !== undefined) {
      amountPaidForUpdate = Number(amount_paid);
      if (!Number.isFinite(amountPaidForUpdate) || amountPaidForUpdate < 0 || amountPaidForUpdate > total) {
        req.session.error = `Amount paid must be between ₱0.00 and the total price of ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
        return res.redirect(`/walk-in-booking/edit/${bookingId}`);
      }
    }
    const paymentMethodForUpdate = payment_method || existingBooking.payment_method || null;

    const updateSql = `UPDATE bookings
       SET name = ?, email = ?, phone = ?, people = ?, checkin = ?, checkout = ?,
           roomType = ?, requests = ?, total_price = ?, nights = ?,
           payment_method = ?, amount_paid = ?, balance = ?,
           pool_addon = ?, pool_adult_count = ?, pool_child_count = ?, pool_fee = ?,
           ktv_addon = ?, ktv_fee = ?, ktv_guest_count = ?, ktv_booking_date = ?, ktv_start_time = ?,
           overnight_extra_guest_count = ?,
           overnight_extra_guest_rate = ?, overnight_extra_guest_fee = ?,
           entrance_fee_per_person = ?, entrance_fee_total = ?, payment_status = ?
       WHERE id = ?`;
    const updateParams = [name, email, phoneNumber || null, guestCount, finalCheckin, finalCheckout, roomType, bookingRequests, totalPrice, calc.nights,
       paymentMethodForUpdate, amountPaidForUpdate, Math.max(0, total - amountPaidForUpdate),
       addons.poolSelected ? 1 : 0, addons.poolAdultCount, addons.poolChildCount, addons.poolFee,
       addons.ktvSelected ? 1 : 0, addons.ktvFee, addons.ktvGuestCount, ktvBookingDate, ktvStartTime,
       extraGuestCount, EXTRA_OVERNIGHT_GUEST_PRICE, extraGuestFee,
       isCottageBooking ? ENTRANCE_FEE_PER_PERSON : 0, entranceFee, paymentStatusForUpdate, bookingId];
    if (addons.ktvSelected) {
      const reservation = await withKtvScheduleLock(async connection => {
        const conflict = await findKtvConflict(connection, ktvBookingDate, ktvStartTime, Number(bookingId));
        if (conflict) return { conflict: true };
        await connection.query(updateSql, updateParams);
        return { conflict: false };
      });
      if (reservation.conflict) {
        req.session.error = "That KTV time slot is already reserved. Choose another available time.";
        return res.redirect(isWalkInBooking ? `/walk-in-booking/edit/${bookingId}` : "/bookings");
      }
    } else {
      await dbQuery(updateSql, updateParams);
    }

    const indexRouter = require("./index");
    await indexRouter.addRevenueForBooking(bookingId);

    const wasFullyPaid = Number(existingBooking.total_price) > 0 &&
      Number(existingBooking.amount_paid) >= Number(existingBooking.total_price);
    if (isWalkInBooking && !wasFullyPaid && total > 0 && amountPaidForUpdate >= total) {
      addAdminNotification(
        req,
        'payment',
        'Walk-in booking fully paid',
        `${name} · ${roomType} · ${formatDateForInput(finalCheckin)}`
      );
    }

    console.log(`✅ Booking #${bookingId} updated. New total: ₱${totalPrice} for ${calc.nights} night(s) in ${calc.roomCategory}`);
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
    const indexRouter = require("./index");
    await indexRouter.addRevenueForBooking(req.params.id);
    await dbQuery("DELETE FROM bookings WHERE id = ?", [req.params.id]);
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Delete Error:", err);
    res.status(500).send("Delete failed: " + (err.message || "Unknown error"));
  }
});

router.post("/mark-fully-paid/:id", checkAuth, async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT b.name, b.email, b.roomType, b.checkin, b.checkout, b.people,
              b.total_price, b.amount_paid, b.downpayment_amount, b.balance,
              b.pool_fee, b.ktv_fee, b.entrance_fee_total,
              b.status, b.bookingSource, b.requests,
              b.pool_addon, b.pool_adult_count, b.pool_child_count, b.ktv_addon,
              r.category AS roomCategory
       FROM bookings b
       LEFT JOIN rooms r ON r.name = b.roomType
       WHERE b.id = ? LIMIT 1`,
      [req.params.id]
    );
    const booking = rows[0];
    if (!booking || booking.status !== 'approved' || booking.bookingSource === 'WALK_IN') {
      req.session.error = "Only approved online bookings can be marked fully paid here.";
      return res.redirect("/bookings");
    }

    const totalPrice = Number(booking.total_price) || 0;
    if (totalPrice <= 0) {
      req.session.error = "This booking does not have a valid total to mark as paid.";
      return res.redirect("/bookings");
    }
    const addons = getBookingAddons(booking);
    const entranceFee = Number(booking.entrance_fee_total) || getEntranceFee(
      Number(booking.people) || 0,
      booking.roomCategory === 'Cottage'
    );
    const poolFee = Number(booking.pool_fee) ||
      (addons.poolAdultCount * 150 + addons.poolChildCount * 100);
    const ktvFee = Number(booking.ktv_fee) || (addons.ktvSelected ? 1000 : 0);
    if (Number(booking.amount_paid) >= totalPrice) {
      req.session.msg = "This booking is already fully paid.";
      return res.redirect("/bookings");
    }

    const updateResult = await dbQuery(
      `UPDATE bookings
       SET amount_paid = total_price, balance = 0, payment_status = 'verified'
       WHERE id = ? AND status = 'approved' AND COALESCE(bookingSource, 'ONLINE') <> 'WALK_IN'`,
      [req.params.id]
    );
    if (updateResult.affectedRows === 0) {
      req.session.msg = "This booking is already fully paid.";
      return res.redirect("/bookings");
    }
    addAdminNotification(
      req,
      'payment',
      'Booking fully paid',
      `${booking.name} · ${booking.roomType} · ${formatDateForInput(booking.checkin)}`
    );
    const indexRouter = require("./index");
    await indexRouter.addRevenueForBooking(req.params.id);
    req.session.triggerPaymentPaid = true;
    req.session.paymentPaidEmail = booking.email;
    req.session.paymentPaidName = booking.name;
    req.session.paymentPaidId = req.params.id;
    req.session.paymentPaidRoom = booking.roomType;
    req.session.paymentPaidCheckin = formatDateForInput(booking.checkin);
    req.session.paymentPaidCheckout = formatDateForInput(booking.checkout);
    req.session.paymentPaidTotal = totalPrice;
    req.session.paymentPaidToday = totalPrice;
    req.session.paymentPaidEntranceFee = entranceFee;
    req.session.paymentPaidPoolFee = poolFee;
    req.session.paymentPaidKtvFee = ktvFee;
    req.session.msg = "Booking marked fully paid.";
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Mark Fully Paid Error:", err);
    res.status(500).send("Could not mark this booking fully paid.");
  }
});

// ===================== POST: Admin Cancel Approved Booking =====================
router.post("/admin-cancel/:id", checkAuth, async (req, res) => {
  try {
    const rows = await dbQuery("SELECT * FROM bookings WHERE id = ?", [req.params.id]);

    const booking = rows[0];
    if (booking) {
      const indexRouter = require("./index");
      await indexRouter.addRevenueForBooking(req.params.id);
    }
    await dbQuery("DELETE FROM bookings WHERE id = ?", [req.params.id]);

    if (booking) {
      req.session.triggerCancel = true;
      req.session.cancelGuestEmail = booking.email;
      req.session.cancelGuestName = booking.name;
      req.session.cancelGuestRoom = booking.roomType;
      req.session.cancelGuestCheckin = formatDateForInput(booking.checkin);
      req.session.cancelGuestId = booking.id;
      req.session.cancelGuestSource = booking.bookingSource || 'ONLINE';
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
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    
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
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const code = String((req.body || {}).code || '');
    
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