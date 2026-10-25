require('dotenv').config();
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const emailjs = require('@emailjs/nodejs'); // EmailJS for OTP
const bookingRoutes = require("./bookings");
const paymentRoutes = require("./payments"); // <-- NEW: GCash/Maya downpayment flow
const {
    normalizeBookingAddons,
    stripCalculatedBookingRequests,
    getOvernightExtraGuestFee,
    getEntranceFee,
    EXTRA_OVERNIGHT_GUEST_PRICE,
    ENTRANCE_FEE_PER_PERSON,
    MAX_BOOKING_GUESTS
} = require("../utils/booking-addons");
const {
    KTV_TIME_SLOTS,
    normalizeKtvStartTime,
    withKtvScheduleLock,
    findKtvConflict,
    isMondayOrTuesday: isKtvClosedDay
} = require("../utils/ktv-schedule");
const getDb = () => require("../config/database");

const checkAuth = (req, res, next) => req.session.isLoggedIn ? next() : res.redirect("/login");

const dbQuery = (sql, params = []) => new Promise((resolve, reject) => {
    getDb().query(sql, params, (err, results) => err ? reject(err) : resolve(results));
});

// ===================== HELPER: Block Monday & Tuesday =====================
function isMondayOrTuesday(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    return dayOfWeek === 1 || dayOfWeek === 2; // 1=Mon, 2=Tue
}

// ===================== HELPER: Auto-checkout for rooms (next calendar day) =====================
function getAutoCheckout(checkinStr) {
    const [year, month, day] = checkinStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function queryWithConnection(connection, sql, params = []) {
    const [results] = await connection.query(sql, params);
    return results;
}

function getRevenueDate(checkin) {
    if (!checkin) throw new Error("Cannot synchronize revenue without a booking date.");
    if (typeof checkin === 'string') return checkin.split(/[ T]/)[0];
    const date = new Date(checkin);
    if (Number.isNaN(date.getTime())) throw new Error("Cannot synchronize revenue with an invalid booking date.");
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function applyRevenueDelta(connection, revenueDate, amountDelta, guestDelta) {
    await queryWithConnection(
        connection,
        `INSERT IGNORE INTO daily_revenue (revenue_date, total_amount, guest_count, last_reset)
         VALUES (?, 0, 0, NOW())`,
        [revenueDate]
    );
    await queryWithConnection(
        connection,
        `UPDATE daily_revenue
         SET total_amount = GREATEST(0, total_amount + ?),
             guest_count = GREATEST(0, guest_count + ?)
         WHERE revenue_date = ?`,
        [amountDelta, guestDelta, revenueDate]
    );
}

async function addRevenueForBooking(bookingId) {
    const connection = await getDb().promise().getConnection();

    try {
        await connection.beginTransaction();

        const bookings = await queryWithConnection(
            connection,
            `SELECT name, email, roomType, people, total_price, amount_paid, balance,
                    payment_method, payment_status, bookingSource, status,
                    DATE_FORMAT(checkin, '%Y-%m-%d') AS checkin_date
             FROM bookings WHERE id = ? LIMIT 1`,
            [bookingId]
        );

        if (bookings.length === 0) {
            await connection.commit();
            return;
        }

        const booking = bookings[0];
        const revenueDate = getRevenueDate(booking.checkin_date);
        const amount = booking.status === 'approved'
            ? Math.round((Number(booking.total_price) || 0) * 100) / 100
            : 0;
        const guestCount = booking.status === 'approved' ? 1 : 0;
        const contributions = await queryWithConnection(
            connection,
            `SELECT DATE_FORMAT(revenue_date, '%Y-%m-%d') AS revenue_date, amount, guest_count
             FROM booking_revenue_contributions
             WHERE booking_id = ? FOR UPDATE`,
            [bookingId]
        );

        if (contributions.length === 0) {
            await queryWithConnection(
                connection,
                `INSERT INTO booking_revenue_contributions
                    (booking_id, revenue_date, amount, guest_count, guest_name, email, room_type,
                     people, booking_status, booking_source, total_price, amount_paid, balance,
                     payment_method, payment_status)
                 VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [bookingId, revenueDate, booking.name, booking.email, booking.roomType, booking.people,
                 booking.status, booking.bookingSource || 'ONLINE', booking.total_price, booking.amount_paid,
                 booking.balance, booking.payment_method, booking.payment_status]
            );
        }

        const previous = contributions[0];
        const previousDate = previous ? getRevenueDate(previous.revenue_date) : revenueDate;
        const previousAmount = previous ? Math.round((Number(previous.amount) || 0) * 100) / 100 : 0;
        const previousGuestCount = previous ? Number(previous.guest_count) || 0 : 0;

        if (previous && previousDate !== revenueDate) {
            await applyRevenueDelta(connection, previousDate, -previousAmount, -previousGuestCount);
            await applyRevenueDelta(connection, revenueDate, amount, guestCount);
        } else {
            await applyRevenueDelta(
                connection,
                revenueDate,
                amount - previousAmount,
                guestCount - previousGuestCount
            );
        }

        await queryWithConnection(
            connection,
            `UPDATE booking_revenue_contributions
             SET revenue_date = ?, amount = ?, guest_count = ?, guest_name = ?, email = ?,
                 room_type = ?, people = ?, booking_status = ?, booking_source = ?,
                 total_price = ?, amount_paid = ?, balance = ?, payment_method = ?, payment_status = ?
             WHERE booking_id = ?`,
            [revenueDate, amount, guestCount, booking.name, booking.email, booking.roomType,
             booking.people, booking.status, booking.bookingSource || 'ONLINE', booking.total_price,
             booking.amount_paid, booking.balance, booking.payment_method, booking.payment_status, bookingId]
        );
        await connection.commit();

        console.log(`✅ Revenue synchronized: ₱${amount} for booking #${bookingId} on ${revenueDate}`);
    } catch (err) {
        await connection.rollback();
        console.error("❌ Error adding revenue for booking:", err);
        throw err;
    } finally {
        connection.release();
    }
}

router.addRevenueForBooking = addRevenueForBooking;

// ===================== LOGIN & LOGOUT =====================

router.get("/login", (req, res) => res.render("admin/login", { error: null, success: req.query.reset === 'success' }));

router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const admins = await dbQuery("SELECT * FROM admin WHERE username = ?", [username]);
        if (admins.length === 0) return res.render("admin/login", { error: "Invalid username or password", success: false });

        if (await bcrypt.compare(password, admins[0].password_hash)) {
            req.session.isLoggedIn = true;
            req.session.adminUsername = admins[0].username;
            res.redirect("/admin-dashboard");
        } else {
            res.render("admin/login", { error: "Invalid username or password", success: false });
        }
    } catch (err) {
        console.error("❌ Login error:", err);
        res.render("admin/login", { error: "System error. Please try again.", success: false });
    }
});

router.get("/logout", (req, res) => { req.session.destroy(); res.redirect("/login"); });


// ===================== PASSWORD RECOVERY (OTP via EmailJS) =====================

// Step 1: Send verification code to admin email
router.post("/forgot-password", async (req, res) => {
    const { username } = req.body;
    try {
        const admins = await dbQuery("SELECT * FROM admin WHERE username = ?", [username]);
        if (admins.length === 0) {
            return res.json({ success: false, error: "Username not found" });
        }

        const admin = admins[0];
        if (!admin.email) {
            return res.json({ success: false, error: "No email registered for this account" });
        }

        // Generate random 6-digit code
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        // Save code to database
        await dbQuery(
            "UPDATE admin SET reset_code = ?, reset_code_expires = ? WHERE id = ?",
            [resetCode, expiresAt, admin.id]
        );

        // Send email via EmailJS — now using process.env
        await emailjs.send(
            process.env.EMAILJS_SERVICE_ID,
            process.env.EMAILJS_TEMPLATE_ID,
            {
                email: admin.email,
                to_name: admin.username,
                verification_code: resetCode
            },
            {
                publicKey: process.env.EMAILJS_PUBLIC_KEY,
                privateKey: process.env.EMAILJS_PRIVATE_KEY
            }
        );

        res.json({ success: true, message: "Verification code sent" });
    } catch (err) {
        console.error("❌ EmailJS send error:", err);
        res.json({ success: false, error: "Failed to send code. Check server console." });
    }
});

// Step 2: Verify the 6-digit code
router.post("/verify-code", async (req, res) => {
    const { username, code } = req.body;
    try {
        const admins = await dbQuery(
            "SELECT * FROM admin WHERE username = ? AND reset_code = ?",
            [username, code]
        );

        if (admins.length === 0) {
            return res.json({ success: false, error: "Invalid verification code" });
        }

        const now = new Date();
        const expires = new Date(admins[0].reset_code_expires);

        if (now > expires) {
            return res.json({ success: false, error: "Code has expired. Request a new one." });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Verify code error:", err);
        res.json({ success: false, error: "Verification failed" });
    }
});

// Step 3: Reset password after code is verified
router.post("/reset-password", async (req, res) => {
    const { username, code, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
        return res.json({ success: false, error: "Passwords do not match" });
    }

    try {
        const admins = await dbQuery(
            "SELECT * FROM admin WHERE username = ? AND reset_code = ?",
            [username, code]
        );

        if (admins.length === 0) {
            return res.json({ success: false, error: "Invalid request. Please start over." });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and clear reset code
        await dbQuery(
            "UPDATE admin SET password_hash = ?, reset_code = NULL, reset_code_expires = NULL WHERE username = ?",
            [hashedPassword, username]
        );

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (err) {
        console.error("❌ Reset password error:", err);
        res.json({ success: false, error: "Failed to update password" });
    }
});


// ===================== ADMIN DASHBOARD ROUTES =====================
router.get("/admin-dashboard", checkAuth, (req, res) => res.render("admin/admin_dashbord"));
router.get("/rooms", checkAuth, (req, res) => res.render("admin/rooms"));
router.get("/form", checkAuth, (req, res) => res.render("admin/form"));
router.get("/food", checkAuth, (req, res) => res.render("admin/food"));

router.get("/", (req, res) => res.redirect("/dashboard"));
router.get("/dashboard", (req, res) => res.render("user/dashboard"));
router.get("/accomodation", (req, res) => res.render("user/accomodation"));
router.get("/experience", (req, res) => res.render("user/experience"));
router.get("/gallery", (req, res) => res.render("user/gallery"));
router.get("/amenities", (req, res) => res.render("user/amenities"));
router.get("/location", (req, res) => res.render("user/location"));
router.get("/live-map", (req, res) => res.render("admin/live-map"));

// ===================== /booking GET route =====================
router.get("/booking", async (req, res) => {
    const msg = req.session.msg || null;
    const err = req.session.error || null;
    
    ['msg', 'error', 'triggerApprove', 'guestName', 'guestEmail'].forEach(k => delete req.session[k]);

    try {
        const rooms = await dbQuery("SELECT * FROM rooms WHERE status = 'available' ORDER BY category, name");
        res.render("user/booking", { 
            message: msg, 
            error: err,
            rooms: rooms || [] 
        });
    } catch (err) {
        console.error("❌ Error loading accommodations:", err);
        res.render("user/booking", { message: msg, error: null, rooms: [] });
    }
});

function buildWhere(baseSql, filters) {
    let sql = baseSql, params = [];
    for (const [key, val] of Object.entries(filters)) {
        if (!val || val === 'all') continue;
        if (key === 'search') { sql += " AND (name LIKE ? OR room_id LIKE ?)"; params.push(`%${val}%`, `%${val}%`); }
        else if (key === 'foodSearch') { sql += " AND (name LIKE ? OR description LIKE ? OR category LIKE ?)"; params.push(`%${val}%`, `%${val}%`, `%${val}%`); }
        else if (key === 'mountainSearch') { sql += " AND (title LIKE ? OR location LIKE ?)"; params.push(`%${val}%`, `%${val}%`); }
        else if (key === 'facilitySearch') { sql += " AND (name LIKE ? OR tag LIKE ?)"; params.push(`%${val}%`, `%${val}%`); }
        else if (key === 'diningSearch') { sql += " AND (name LIKE ? OR tag LIKE ?)"; params.push(`%${val}%`, `%${val}%`); }
        else { sql += " AND category = ?"; params.push(val); }
    }
    return { sql, params };
}


// ===================== BOOKING SCHEDULE API (Public) =====================
router.get("/api/booking-schedule", async (req, res) => {
    try {
        const bookings = await dbQuery(`
            SELECT 
                b.roomType,
                b.checkin,
                b.checkout,
                b.people,
                b.status,
                b.bookingSource,
                r.category
            FROM bookings b
            LEFT JOIN rooms r ON b.roomType = r.name
            WHERE (
                (r.category = 'Cottage' AND b.checkout > NOW())
                OR (COALESCE(r.category, '') <> 'Cottage' AND DATE(b.checkout) >= CURDATE())
            )
              AND b.status IN ('pending', 'approved', 'pending_payment')
              AND (b.status <> 'pending_payment' OR b.hold_expires_at > NOW())
            ORDER BY b.checkin ASC
        `);

        const schedule = {};

        bookings.forEach(booking => {
            const roomName = booking.roomType;

            if (!schedule[roomName]) {
                schedule[roomName] = [];
            }

            schedule[roomName].push({
                checkin: booking.checkin,
                checkout: booking.checkout,
                guests: booking.people,
                status: booking.status,
                category: booking.category || 'Room',
                bookingSource: booking.bookingSource || 'ONLINE'
            });
        });

        res.json({ success: true, schedule });
    } catch (err) {
        console.error("❌ Booking schedule error:", err);
        res.status(500).json({ error: "Failed to load booking schedule" });
    }
});

router.get("/api/ktv-schedule", async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
            ? String(req.query.date)
            : null;
        const excludeBookingId = req.session.isLoggedIn && /^\d+$/.test(String(req.query.excludeBookingId || ''))
            ? Number(req.query.excludeBookingId)
            : null;
        const bookings = await dbQuery(`
            SELECT id, DATE_FORMAT(COALESCE(ktv_booking_date, DATE(checkin)), '%Y-%m-%d') AS bookingDate,
                   ktv_start_time, status, bookingSource
            FROM bookings
            WHERE ktv_addon = 1
              AND COALESCE(ktv_booking_date, DATE(checkin)) >= CURDATE()
              AND (
                status IN ('pending', 'approved')
                OR (status = 'pending_payment' AND hold_expires_at > NOW())
              )
              AND (? IS NULL OR COALESCE(ktv_booking_date, DATE(checkin)) = ?)
              AND (? IS NULL OR id <> ?)
            ORDER BY bookingDate, ktv_start_time
        `, [requestedDate, requestedDate, excludeBookingId, excludeBookingId]);

        res.json({
            success: true,
            slots: KTV_TIME_SLOTS,
            bookings: bookings.map(booking => ({
                date: String(booking.bookingDate).slice(0, 10),
                startTime: booking.ktv_start_time ? String(booking.ktv_start_time).slice(0, 8) : null,
                status: booking.status,
                bookingSource: booking.bookingSource || 'ONLINE',
                schedulePending: !booking.ktv_start_time
            }))
        });
    } catch (err) {
        console.error("❌ KTV schedule error:", err);
        res.status(500).json({ success: false, error: "Failed to load KTV availability" });
    }
});

// ===================== ROOMS API =====================
router.get("/api/rooms", async (req, res) => {
    try {
        const { sql, params } = buildWhere("SELECT * FROM rooms WHERE 1=1", { category: req.query.category, search: req.query.search });
        res.json(await dbQuery(sql + " ORDER BY created_at DESC", params));
    } catch (err) { console.error("❌ Error fetching rooms:", err); res.status(500).json({ error: "Failed to fetch rooms" }); }
});

router.get("/api/rooms/:id", async (req, res) => {
    try {
        const results = await dbQuery("SELECT * FROM rooms WHERE room_id = ?", [req.params.id]);
        results.length === 0 ? res.status(404).json({ error: "Room not found" }) : res.json(results[0]);
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

router.post("/api/rooms", checkAuth, async (req, res) => {
    const { room_id, name, category, price, occupancy, status, image } = req.body;
    try {
        const result = await dbQuery(
            "INSERT INTO rooms (room_id, name, category, price, occupancy, status, image, added_to_gallery) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
            [room_id, name, category, price, occupancy, status, image]
        );
        res.json({ success: true, id: result.insertId, room_id });
    } catch (err) { console.error("❌ Error adding room:", err); res.status(500).json({ error: "Failed to add room" }); }
});

router.put("/api/rooms/:id", checkAuth, async (req, res) => {
    const { name, category, price, occupancy, status, image } = req.body;
    try {
        await dbQuery("UPDATE rooms SET name=?, category=?, price=?, occupancy=?, status=?, image=? WHERE room_id=?",
            [name, category, price, occupancy, status, image, req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error updating room:", err); res.status(500).json({ error: "Failed to update room" }); }
});

router.patch("/api/rooms/:id/status", checkAuth, async (req, res) => {
    try {
        await dbQuery("UPDATE rooms SET status = ? WHERE room_id = ?", [req.body.status, req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error updating status:", err); res.status(500).json({ error: "Failed to update status" }); }
});

router.delete("/api/rooms/:id", checkAuth, async (req, res) => {
    try {
        await dbQuery("DELETE FROM rooms WHERE room_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error deleting room:", err); res.status(500).json({ error: "Failed to delete room" }); }
});

router.get("/api/rooms/stats/overview", async (req, res) => {
    try {
        const results = await dbQuery(`
            SELECT 
                SUM(CASE WHEN category != 'Cottage' THEN 1 ELSE 0 END) as total, 
                SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN category='Cottage' THEN 1 ELSE 0 END) as cottages
            FROM rooms
        `);
        res.json(results[0]);
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});


// ===================== MOUNTAIN VIEWS API =====================
router.get("/api/mountain-views", async (req, res) => {
    try {
        const { sql, params } = buildWhere("SELECT * FROM mountain_views WHERE 1=1", { mountainSearch: req.query.search });
        res.json(await dbQuery(sql + " ORDER BY added_at DESC", params));
    } catch (err) { console.error("❌ Error fetching mountain views:", err); res.status(500).json({ error: "Failed to fetch mountain views" }); }
});

router.post("/api/mountain-views", checkAuth, async (req, res) => {
    const { view_id, title, location, image } = req.body;
    try {
        const result = await dbQuery("INSERT INTO mountain_views (view_id, title, location, image) VALUES (?, ?, ?, ?)", [view_id, title, location, image]);
        res.json({ success: true, id: result.insertId, view_id });
    } catch (err) { console.error("❌ Error adding mountain view:", err); res.status(500).json({ error: "Failed to add mountain view" }); }
});

router.delete("/api/mountain-views/:id", checkAuth, async (req, res) => {
    try {
        await dbQuery("DELETE FROM mountain_views WHERE view_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error deleting mountain view:", err); res.status(500).json({ error: "Failed to delete mountain view" }); }
});


// ===================== FACILITIES API =====================
router.get("/api/facilities", async (req, res) => {
    try {
        const { sql, params } = buildWhere("SELECT * FROM facilities WHERE 1=1", { facilitySearch: req.query.search });
        res.json(await dbQuery(sql + " ORDER BY created_at DESC", params));
    } catch (err) { console.error("❌ Error fetching facilities:", err); res.status(500).json({ error: "Failed to fetch facilities" }); }
});

router.get("/api/facilities/:id", async (req, res) => {
    try {
        const results = await dbQuery("SELECT * FROM facilities WHERE facility_id = ?", [req.params.id]);
        results.length === 0 ? res.status(404).json({ error: "Facility not found" }) : res.json(results[0]);
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

router.post("/api/facilities", checkAuth, async (req, res) => {
    const { facility_id, name, tag, description, image } = req.body;
    try {
        const result = await dbQuery(
            "INSERT INTO facilities (facility_id, name, tag, description, image) VALUES (?, ?, ?, ?, ?)",
            [facility_id, name, tag, description, image]
        );
        res.json({ success: true, id: result.insertId, facility_id });
    } catch (err) { console.error("❌ Error adding facility:", err); res.status(500).json({ error: "Failed to add facility" }); }
});

router.delete("/api/facilities/:id", checkAuth, async (req, res) => {
    try {
        await dbQuery("DELETE FROM facilities WHERE facility_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error deleting facility:", err); res.status(500).json({ error: "Failed to delete facility" }); }
});


// ===================== DINING SPOTS API =====================
router.get("/api/dining-spots", async (req, res) => {
    try {
        const { sql, params } = buildWhere("SELECT * FROM dining_spots WHERE 1=1", { diningSearch: req.query.search });
        res.json(await dbQuery(sql + " ORDER BY created_at DESC", params));
    } catch (err) { console.error("❌ Error fetching dining spots:", err); res.status(500).json({ error: "Failed to fetch dining spots" }); }
});

router.get("/api/dining-spots/:id", async (req, res) => {
    try {
        const results = await dbQuery("SELECT * FROM dining_spots WHERE dining_id = ?", [req.params.id]);
        results.length === 0 ? res.status(404).json({ error: "Dining spot not found" }) : res.json(results[0]);
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

router.post("/api/dining-spots", checkAuth, async (req, res) => {
    const { dining_id, name, tag, description, image } = req.body;
    try {
        const result = await dbQuery(
            "INSERT INTO dining_spots (dining_id, name, tag, description, image) VALUES (?, ?, ?, ?, ?)",
            [dining_id, name, tag, description, image]
        );
        res.json({ success: true, id: result.insertId, dining_id });
    } catch (err) { console.error("❌ Error adding dining spot:", err); res.status(500).json({ error: "Failed to add dining spot" }); }
});

router.delete("/api/dining-spots/:id", checkAuth, async (req, res) => {
    try {
        await dbQuery("DELETE FROM dining_spots WHERE dining_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error deleting dining spot:", err); res.status(500).json({ error: "Failed to delete dining spot" }); }
});


// ===================== FOOD ITEMS API =====================
router.get("/api/food-items", async (req, res) => {
    try {
        const { sql, params } = buildWhere("SELECT * FROM food_items WHERE 1=1", { category: req.query.category, foodSearch: req.query.search });
        res.json(await dbQuery(sql + " ORDER BY created_at DESC", params));
    } catch (err) { console.error("❌ Error fetching food items:", err); res.status(500).json({ error: "Failed to fetch food items" }); }
});

router.get("/api/food-items/:id", async (req, res) => {
    try {
        const results = await dbQuery("SELECT * FROM food_items WHERE food_id = ?", [req.params.id]);
        results.length === 0 ? res.status(404).json({ error: "Food item not found" }) : res.json(results[0]);
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

router.post("/api/food-items", checkAuth, async (req, res) => {
    const { name, category, price, popularity, description, stock_status, image } = req.body;

    try {
         const results = await dbQuery(
            "SELECT food_id FROM food_items WHERE food_id LIKE 'FD%' ORDER BY CAST(SUBSTRING(food_id, 3) AS UNSIGNED) DESC LIMIT 1"
        );

        let nextNum = 1;
        if (results.length > 0) {
            const lastId = results[0].food_id;
            const match = lastId.match(/FD(\d+)/);
            if (match) nextNum = parseInt(match[1]) + 1;
        }

        const food_id = 'FD' + String(nextNum).padStart(3, '0');

        const result = await dbQuery(
            "INSERT INTO food_items (food_id, name, category, price, popularity, description, stock_status, image, added_to_gallery) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
            [food_id, name, category, price, popularity, description, stock_status, image]
        );

        res.json({ success: true, id: result.insertId, food_id });
    } catch (err) { 
        console.error("❌ Error adding food item:", err); 
        res.status(500).json({ error: "Failed to add food item", details: err.message }); 
    }
});

router.put("/api/food-items/:id", checkAuth, async (req, res) => {
    const { name, category, price, popularity, description, stock_status } = req.body;
    try {
        await dbQuery("UPDATE food_items SET name=?, category=?, price=?, popularity=?, description=?, stock_status=? WHERE food_id=?",
            [name, category, price, popularity, description, stock_status, req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error updating food item:", err); res.status(500).json({ error: "Failed to update food item" }); }
});

router.delete("/api/food-items/:id", checkAuth, async (req, res) => {
    try {
        await dbQuery("DELETE FROM food_items WHERE food_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error deleting food item:", err); res.status(500).json({ error: "Failed to delete food item" }); }
});


// ===================== AMENITIES API (Public) =====================
router.get("/api/amenities", async (req, res) => {
    try {
        const [dining, facilities] = await Promise.all([
            dbQuery("SELECT dining_id as id, name, tag, description, image, 'dining' as type FROM dining_spots"),
            dbQuery("SELECT facility_id as id, name, tag, description, image, 'facility' as type FROM facilities")
        ]);
        res.json({ dining, facilities });
    } catch (err) { console.error("❌ Error fetching amenities:", err); res.status(500).json({ error: "Failed to fetch amenities" }); }
});


// ===================== GALLERY API =====================
router.get("/api/gallery", async (req, res) => {
    const { type } = req.query;
    const db = getDb();

    const run = (sql) => new Promise((resolve, reject) => db.query(sql, (err, r) => err ? reject(err) : resolve(r || [])));

    try {
        const [rooms, mountainViews, dining] = await Promise.all([
            (!type || type === 'all' || type === 'rooms') ? run("SELECT room_id as id, name, category, price, occupancy, status, image, 'room' as type FROM rooms WHERE added_to_gallery = 1") : Promise.resolve([]),
            (!type || type === 'all' || type === 'mountain') ? run("SELECT view_id as id, title as name, location, image, 'mountain' as type FROM mountain_views") : Promise.resolve([]),
            (!type || type === 'all' || type === 'dining') ? run("SELECT food_id as id, name, category, price, popularity, description, stock_status, image, 'dining' as type FROM food_items WHERE added_to_gallery = 1") : Promise.resolve([])
        ]);
        res.json({ rooms, mountainViews, dining });
    } catch (err) { console.error("❌ Error fetching gallery data:", err); res.status(500).json({ error: "Failed to fetch gallery data" }); }
});


// ===================== Submit an online booking for admin approval =====================
router.post("/create", async (req, res) => {
    const body = req.body || {};
    const { name, people, roomType, requests, checkin, bookingDate, checkinTime, checkoutTime } = body;
    const phone = String(body.phone || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const wantsJson = req.is('application/json');
    const reject = (message, status = 400) => {
        if (wantsJson) return res.status(status).json({ success: false, message });
        req.session.error = message;
        return res.redirect("/booking");
    };
    const bookingConflictMessage = (booking, isCottage, dateValue) => {
        const accommodation = isCottage ? "cottage" : "room";
        const date = new Date(`${dateValue}T00:00:00`).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        if (booking.bookingSource === 'WALK_IN') {
            return `This ${accommodation} is already approved and recorded as a walk-in booking for ${date}. Please choose another ${accommodation} or change the date.`;
        }
        if (booking.status === 'approved') {
            return `This ${accommodation} already has an approved online booking for ${date}. Please choose another ${accommodation} or change the date.`;
        }
        return `An online booking request for this ${accommodation} is already on file for ${date} and is awaiting approval. Please choose another ${accommodation} or change the date.`;
    };

    if (!name || !phone || !email || !roomType) {
        return reject("Please fill in your name, phone number, email, and choose an accommodation.");
    }

    if (!/^\+639\d{9}$/.test(phone)) {
        return reject("Enter a valid mobile number starting with 9 or 09, followed by nine more digits.");
    }

    if (!req.session.verificationCodes ||
        !req.session.verificationCodes[email] ||
        !req.session.verificationCodes[email].verified) {
        return reject("Please verify your email address before submitting your booking.");
    }

    try {
        // The public booking form submits directly to this route, so also
        // clear expired holds here before checking availability.
        await dbQuery(
            "DELETE FROM bookings WHERE status = 'pending_payment' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()"
        );

        const roomResults = await dbQuery("SELECT price, category, occupancy FROM rooms WHERE name = ? LIMIT 1", [roomType]);
        if (roomResults.length === 0) return reject("Selected accommodation was not found.");
        const roomCategory = roomResults[0].category;
        const isCottage = (roomCategory === 'Cottage');

        const maxOccupancy = parseInt(roomResults[0].occupancy, 10) || 1;
        const guestCount = Number(people);
        if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_BOOKING_GUESTS) {
            return reject(`Guest count must be between 1 and ${MAX_BOOKING_GUESTS}.`);
        }
        if (isCottage && guestCount > maxOccupancy) {
            return reject(`This cottage can accommodate up to ${maxOccupancy} guests.`);
        }

        const maxPaidPoolUsers = isCottage ? guestCount : Math.max(0, guestCount - maxOccupancy);
        const addons = normalizeBookingAddons(body, guestCount, maxPaidPoolUsers);
        if (addons.error) return reject(addons.error);
        const ktvStartTime = addons.ktvSelected ? normalizeKtvStartTime(body.ktvStartTime) : null;
        if (addons.ktvSelected && !ktvStartTime) {
            return reject("Select an available KTV time slot.");
        }

        let finalCheckin, finalCheckout, totalPrice, nights;

        if (isCottage) {
            if (!bookingDate || !checkinTime || !checkoutTime) {
                return reject("Please fill in the booking date, check-in time, and check-out time for the cottage.");
            }

            // BLOCK MONDAY & TUESDAY
            if (isMondayOrTuesday(bookingDate)) {
                return reject("We are closed every Monday and Tuesday. Please choose a different date.");
            }

            // Combine into MySQL DATETIME format
            finalCheckin = bookingDate + ' ' + checkinTime + ':00';
            finalCheckout = bookingDate + ' ' + checkoutTime + ':00';

            if (checkinTime >= checkoutTime) {
                return reject("Check-out time must be later than check-in time.");
            }

            const duplicate = await dbQuery(`
                SELECT id, bookingSource, status FROM bookings
                WHERE LOWER(email) = ? AND roomType = ?
                  AND DATE(checkin) = DATE(?) AND DATE(checkout) = DATE(?)
                  AND (
                    status IN ('pending', 'approved')
                    OR (status = 'pending_payment' AND hold_expires_at > NOW())
                  )
                LIMIT 1
            `, [email, roomType, finalCheckin, finalCheckout]);
            if (duplicate.length > 0) {
                return reject(bookingConflictMessage(duplicate[0], isCottage, bookingDate), 409);
            }

            // Include online and walk-in reservations, but ignore cancelled bookings and expired holds.
            const overlapCheck = await dbQuery(`
                SELECT checkin, checkout, bookingSource, status FROM bookings
                WHERE roomType = ? AND DATE(checkin) = DATE(?)
                  AND (
                    status IN ('pending', 'approved')
                    OR (status = 'pending_payment' AND hold_expires_at > NOW())
                  )
                LIMIT 1
            `, [roomType, finalCheckin]);

            if (overlapCheck.length > 0) {
                return reject(bookingConflictMessage(overlapCheck[0], isCottage, bookingDate), 409);
            }

            const roomPrice = roomResults.length > 0 ? parseFloat(roomResults[0].price) : 0;
            totalPrice = roomPrice;
            nights = 0;

        } else {
            // ROOMS: Only check-in date needed — auto-calculate checkout
            if (!checkin) {
                return reject("Please select a check-in date.");
            }

            // BLOCK MONDAY & TUESDAY for checkin
            if (isMondayOrTuesday(checkin)) {
                return reject("Check-in cannot be on Monday or Tuesday. We are closed those days.");
            }

            // Room checkout is the next calendar day, including Monday after a Sunday check-in.
            finalCheckin = checkin;
            finalCheckout = getAutoCheckout(checkin);

            const duplicate = await dbQuery(`
                SELECT id, bookingSource, status FROM bookings
                WHERE LOWER(email) = ? AND roomType = ?
                  AND DATE(checkin) = DATE(?) AND DATE(checkout) = DATE(?)
                  AND (
                    status IN ('pending', 'approved')
                    OR (status = 'pending_payment' AND hold_expires_at > NOW())
                  )
                LIMIT 1
            `, [email, roomType, finalCheckin, finalCheckout]);
            if (duplicate.length > 0) {
                return reject(bookingConflictMessage(duplicate[0], isCottage, checkin), 409);
            }

            // Include online and walk-in reservations, but ignore cancelled bookings and expired holds.
            const overlapCheck = await dbQuery(`
                SELECT checkin, checkout, bookingSource, status FROM bookings
                WHERE roomType = ? AND checkin < ? AND checkout > ?
                  AND (
                    status IN ('pending', 'approved')
                    OR (status = 'pending_payment' AND hold_expires_at > NOW())
                  )
                LIMIT 1
            `, [roomType, finalCheckout, finalCheckin]);

            if (overlapCheck.length > 0) {
                return reject(bookingConflictMessage(overlapCheck[0], isCottage, checkin), 409);
            }

            const checkinDate = new Date(finalCheckin);
            const checkoutDate = new Date(finalCheckout);
            nights = Math.max(1, Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24)));
            const roomPrice = roomResults.length > 0 ? parseFloat(roomResults[0].price) : 0;
            totalPrice = roomPrice * nights;
        }

        const ktvBookingDate = addons.ktvSelected ? String(finalCheckin).slice(0, 10) : null;
        if (addons.ktvSelected && isKtvClosedDay(ktvBookingDate)) {
            return reject("The KTV is closed on Mondays and Tuesdays. Please select another booking date.");
        }

        const basePrice = totalPrice;
        const extraGuestCount = isCottage ? 0 : Math.max(0, guestCount - maxOccupancy);
        const extraGuestFee = getOvernightExtraGuestFee(guestCount, maxOccupancy, nights);
        const entranceFee = getEntranceFee(guestCount, isCottage);
        totalPrice += addons.price + extraGuestFee + entranceFee;
        const bookingRequests = stripCalculatedBookingRequests(requests);
        const insertSql = `INSERT INTO bookings
             (name, phone, email, people, checkin, checkout, roomType, requests, status, total_price, nights,
              pool_addon, pool_adult_count, pool_child_count, pool_fee, ktv_addon, ktv_fee, ktv_guest_count,
              ktv_booking_date, ktv_start_time,
              overnight_extra_guest_count, overnight_extra_guest_rate, overnight_extra_guest_fee,
              entrance_fee_per_person, entrance_fee_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ;
        const insertParams = [
            name, phone, email, guestCount, finalCheckin, finalCheckout, roomType, bookingRequests, totalPrice, nights,
            addons.poolSelected ? 1 : 0, addons.poolAdultCount, addons.poolChildCount, addons.poolFee,
            addons.ktvSelected ? 1 : 0, addons.ktvFee, addons.ktvGuestCount, ktvBookingDate, ktvStartTime,
            extraGuestCount, EXTRA_OVERNIGHT_GUEST_PRICE, extraGuestFee,
            isCottage ? ENTRANCE_FEE_PER_PERSON : 0, entranceFee
        ];
        let result;
        if (addons.ktvSelected) {
            const reservation = await withKtvScheduleLock(async connection => {
                const conflict = await findKtvConflict(connection, ktvBookingDate, ktvStartTime);
                if (conflict) return { conflict: true };
                const [insertResult] = await connection.query(insertSql, insertParams);
                return { result: insertResult };
            });
            if (reservation.conflict) {
                return reject("That KTV time slot was just booked. Please choose another available time.", 409);
            }
            result = reservation.result;
        } else {
            result = await dbQuery(insertSql, insertParams);
        }

        delete req.session.verificationCodes[email];

        const priceLabel = isCottage 
            ? `₱${basePrice.toLocaleString()} (Flat Rate - Day Use)`
            : `₱${basePrice.toLocaleString()} for ${nights} night(s)`;
        const chargeDetails = [];
        if (addons.price > 0) chargeDetails.push(`Add-ons: ₱${addons.price.toLocaleString()}`);
        if (addons.ktvSelected) {
            const slot = KTV_TIME_SLOTS.find(item => item.start === ktvStartTime);
            chargeDetails.push(`KTV schedule: ${ktvBookingDate}, ${slot.label}`);
        }
        if (extraGuestFee > 0) chargeDetails.push(`Extra overnight guests: ₱${extraGuestFee.toLocaleString()}`);
        if (entranceFee > 0) chargeDetails.push(`Entrance fee: ₱${entranceFee.toLocaleString()}`);
        const chargeLabel = chargeDetails.length > 0 ? ` ${chargeDetails.join(". ")}.` : "";
        const message = `Booking request submitted! ${roomCategory}: ${priceLabel}.${chargeLabel} Total: ₱${totalPrice.toLocaleString()}. Please wait for admin approval.`;
        req.session.msg = message;
        if (wantsJson) return res.json({ success: true, bookingId: result.insertId, message });
        res.redirect("/booking");

    } catch (err) {
        console.error("❌ SQL Error in /create:", err);
        if (wantsJson) return res.status(500).json({ success: false, message: "Could not submit your booking. Please try again." });
        res.status(500).send("Database Error: " + (err.message || "Unknown error"));
    }
});

router.get("/api/dashboard/stats", checkAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const [summaryResults, onlineCheckins, walkInCheckins] = await Promise.all([
            dbQuery(`
                SELECT
                    COALESCE((SELECT total_amount FROM daily_revenue WHERE revenue_date = ? LIMIT 1), 0) AS dailyRevenue,
                    (SELECT COUNT(*) FROM bookings WHERE status = 'approved') AS activeGuests,
                    COALESCE((SELECT SUM(total_amount) FROM daily_revenue), 0) AS totalRevenue,
                    COALESCE((SELECT SUM(guest_count) FROM daily_revenue), 0) AS totalGuestsAllTime
            `, [today]),
            dbQuery(`
                SELECT name, roomType, checkin, status, people
                FROM bookings
                WHERE bookingSource IS NULL OR bookingSource != 'WALK_IN'
                ORDER BY id DESC
                LIMIT 5
            `),
            dbQuery(`
                SELECT name, roomType, checkin, status, people, payment_status, payment_method
                FROM bookings
                WHERE bookingSource = 'WALK_IN'
                ORDER BY id DESC
                LIMIT 5
            `)
        ]);
        const summary = summaryResults[0] || {};

        res.json({ 
            dailyRevenue: summary.dailyRevenue,
            activeGuests: summary.activeGuests,
            totalRevenue: summary.totalRevenue,
            totalGuestsAllTime: summary.totalGuestsAllTime,
            recentOnlineBookings: onlineCheckins || [],
            recentWalkInBookings: walkInCheckins || []
        });
    } catch (err) {
        console.error("❌ Dashboard stats error:", err);
        res.status(500).json({ error: "Failed to load dashboard stats" });
    }
});


// --- GET: Revenue Log ---
router.get("/api/dashboard/revenue-log", checkAuth, async (req, res) => {
    try {
        const log = await dbQuery(`
            SELECT 
                id,
                DATE_FORMAT(revenue_date, '%Y-%m-%d') AS revenue_date,
                total_amount,
                guest_count,
                last_reset
            FROM daily_revenue
            ORDER BY revenue_date DESC
        `);

        res.json({ success: true, log: log || [] });
    } catch (err) {
        console.error("❌ Revenue log error:", err);
        res.status(500).json({ error: "Failed to load revenue log" });
    }
});

router.get("/api/dashboard/revenue-log/:date/bookings", checkAuth, async (req, res) => {
    const date = String(req.params.date || '');
    const [year, month, day] = date.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        parsedDate.getUTCFullYear() !== year ||
        parsedDate.getUTCMonth() !== month - 1 ||
        parsedDate.getUTCDate() !== day) {
        return res.status(400).json({ success: false, error: "A valid revenue date is required." });
    }

    try {
        const bookings = await dbQuery(`
            SELECT booking_id AS id, guest_name AS name, email, room_type AS roomType,
                   people, booking_status AS status, booking_source AS bookingSource,
                   total_price, amount_paid, balance, payment_method, payment_status
            FROM booking_revenue_contributions
            WHERE revenue_date = ?
            ORDER BY booking_source, guest_name, booking_id
        `, [date]);
        res.json({ success: true, date, bookings: bookings || [] });
    } catch (err) {
        console.error("❌ Revenue booking records error:", err);
        res.status(500).json({ success: false, error: "Failed to load bookings for this revenue date." });
    }
});

router.delete("/api/dashboard/revenue-log/:date/bookings/:bookingId", checkAuth, async (req, res) => {
    const { date, bookingId } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d+$/.test(bookingId)) {
        return res.status(400).json({ success: false, error: "A valid revenue date and booking record are required." });
    }

    let connection;
    try {
        connection = await getDb().promise().getConnection();
        await connection.beginTransaction();
        const [records] = await connection.query(
            `SELECT amount, guest_count
             FROM booking_revenue_contributions
             WHERE booking_id = ? AND revenue_date = ?
             FOR UPDATE`,
            [bookingId, date]
        );
        if (!records.length) {
            await connection.rollback();
            return res.status(404).json({ success: false, error: "The revenue booking record was not found." });
        }

        const record = records[0];
        await connection.query(
            `UPDATE daily_revenue
             SET total_amount = GREATEST(0, total_amount - ?),
                 guest_count = GREATEST(0, guest_count - ?)
             WHERE revenue_date = ?`,
            [record.amount, record.guest_count, date]
        );
        await connection.query(
            "DELETE FROM booking_revenue_contributions WHERE booking_id = ? AND revenue_date = ?",
            [bookingId, date]
        );
        await connection.commit();
        res.json({ success: true, message: "Revenue booking record deleted." });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ Delete revenue booking record error:", err);
        res.status(500).json({ success: false, error: "Failed to delete the revenue booking record." });
    } finally {
        if (connection) connection.release();
    }
});


// --- POST: Reset daily revenue to 0 ---
router.post("/api/dashboard/reset-revenue", checkAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        await dbQuery(
            `INSERT INTO daily_revenue (revenue_date, total_amount, guest_count, last_reset) 
             VALUES (?, 0, 0, NOW()) 
             ON DUPLICATE KEY UPDATE total_amount = 0, guest_count = 0, last_reset = NOW()`,
            [today]
        );

        res.json({ success: true, message: "Daily revenue reset to ₱0.00" });
    } catch (err) {
        console.error("❌ Reset revenue error:", err);
        res.status(500).json({ error: "Failed to reset revenue" });
    }
});


// --- DELETE: Delete a revenue log entry ---
router.delete("/api/dashboard/revenue-log/:id", checkAuth, async (req, res) => {
    try {
        const logId = req.params.id;
        await dbQuery("DELETE FROM daily_revenue WHERE id = ?", [logId]);

        res.json({ success: true, message: "Revenue log entry deleted" });
    } catch (err) {
        console.error("❌ Delete revenue log error:", err);
        res.status(500).json({ error: "Failed to delete revenue log entry" });
    }
});


router.use("/", paymentRoutes);   // <-- NEW: /api/create-hold, /api/submit-payment, /api/verify-payment/:id, /api/cancel-hold/:id, /api/cleanup-expired-holds
router.use("/", bookingRoutes);

module.exports = router;