const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const bookingRoutes = require("./bookings");
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

// ===================== HELPER: Auto-checkout for rooms (next day, skip Mon/Tue) =====================
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

async function addRevenueForBooking(bookingId) {
    try {
        const bookings = await dbQuery(
            "SELECT total_price, people, checkin FROM bookings WHERE id = ?",
            [bookingId]
        );

        if (bookings.length === 0) return;

        const booking = bookings[0];

        const checkinStr = booking.checkin;
        let revenueDate;

        if (typeof checkinStr === 'string') {
            if (checkinStr.includes('T')) {
                revenueDate = checkinStr.split('T')[0];
            } else if (checkinStr.includes(' ')) {
                revenueDate = checkinStr.split(' ')[0];
            } else {
                revenueDate = checkinStr;
            }
        } else {
            const date = new Date(checkinStr);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            revenueDate = `${year}-${month}-${day}`;
        }

        const amount = parseFloat(booking.total_price) || 0;
        const guestCount = 1;

        await dbQuery(
            `INSERT INTO daily_revenue (revenue_date, total_amount, guest_count, last_reset) 
             VALUES (?, ?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE 
                total_amount = total_amount + VALUES(total_amount),
                guest_count = guest_count + VALUES(guest_count)`,
            [revenueDate, amount, guestCount]
        );

        console.log(`✅ Revenue added: ₱${amount} for 1 guest on ${revenueDate}`);
    } catch (err) {
        console.error("❌ Error adding revenue for booking:", err);
    }
}

router.addRevenueForBooking = addRevenueForBooking;

router.get("/login", (req, res) => res.render("admin/login", { error: null }));

router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const admins = await dbQuery("SELECT * FROM admin WHERE username = ?", [username]);
        if (admins.length === 0) return res.render("admin/login", { error: "Invalid username or password" });

        if (await bcrypt.compare(password, admins[0].password_hash)) {
            req.session.isLoggedIn = true;
            req.session.adminUsername = admins[0].username;
            res.redirect("/admin-dashboard");
        } else {
            res.render("admin/login", { error: "Invalid username or password" });
        }
    } catch (err) {
        console.error("❌ Login error:", err);
        res.render("admin/login", { error: "System error. Please try again." });
    }
});

router.get("/logout", (req, res) => { req.session.destroy(); res.redirect("/login"); });


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


// ===================== BOOKING SCHEDULE API (Public) — UPDATED =====================
router.get("/api/booking-schedule", async (req, res) => {
    try {
        const now = new Date();
        
        const bookings = await dbQuery(`
            SELECT 
                b.roomType,
                b.checkin,
                b.checkout,
                b.people,
                b.status,
                r.category
            FROM bookings b
            LEFT JOIN rooms r ON b.roomType = r.name
            WHERE b.checkout >= CURDATE()
            ORDER BY b.checkin ASC
        `);

        const schedule = {};

        bookings.forEach(booking => {
            const checkin = new Date(booking.checkin);
            const checkout = new Date(booking.checkout);
            const isCottage = booking.category === 'Cottage';
            
            let isExpired = false;
            
            if (isCottage) {
                // 🏡 COTTAGE: Remove from schedule when checkout time is reached
                // e.g., Aug 9, 8AM–5PM → disappears after 5:00 PM
                isExpired = now >= checkout;
            } else {
                // 🏨 ROOM: Remove from schedule 22 hours after check-in
                // e.g., checked in Aug 9 at 2PM → disappears Aug 10 at 12PM
                const hoursSinceCheckin = (now - checkin) / (1000 * 60 * 60);
                isExpired = hoursSinceCheckin >= 22;
            }
            
            // Only add to schedule if NOT expired
            if (!isExpired) {
                const roomName = booking.roomType;

                if (!schedule[roomName]) {
                    schedule[roomName] = [];
                }

                schedule[roomName].push({
                    checkin: booking.checkin,
                    checkout: booking.checkout,
                    guests: booking.people,
                    status: booking.status
                });
            }
        });

        res.json({ success: true, schedule });
    } catch (err) {
        console.error("❌ Booking schedule error:", err);
        res.status(500).json({ error: "Failed to load booking schedule" });
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
        const dining = await dbQuery("SELECT dining_id as id, name, tag, description, image, 'dining' as type FROM dining_spots");
        const facilities = await dbQuery("SELECT facility_id as id, name, tag, description, image, 'facility' as type FROM facilities");
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


// ===================== UPDATED: /create with Email Verification + Room Auto-Checkout + Cottage day-use + Mon/Tue block =====================
router.post("/create", async (req, res) => {
    const { name, email, people, roomType, requests, checkin, checkout, bookingDate, checkinTime, checkoutTime } = req.body;

    console.log("📥 /create received:", { 
        roomType, bookingDate, checkinTime, checkoutTime, checkin, checkout 
    });

    // ===================== STEP 1: CHECK EMAIL VERIFICATION =====================
    if (!req.session.verificationCodes || 
        !req.session.verificationCodes[email] || 
        !req.session.verificationCodes[email].verified) {
        
        req.session.error = "Please verify your email address before booking. Click 'Send Code' and enter the verification code.";
        return res.redirect("/booking");
    }

    try {
        const roomResults = await dbQuery("SELECT price, category, occupancy FROM rooms WHERE name = ? LIMIT 1", [roomType]);
        const roomCategory = roomResults.length > 0 ? roomResults[0].category : 'Room';
        const isCottage = (roomCategory === 'Cottage');

        const maxOccupancy = roomResults.length > 0 ? parseInt(roomResults[0].occupancy) : 1;
        let guestCount = parseInt(people) || 1;
        if (guestCount > maxOccupancy && maxOccupancy > 0) guestCount = maxOccupancy;

        let finalCheckin, finalCheckout, totalPrice, nights;

        if (isCottage) {
            if (!bookingDate || !checkinTime || !checkoutTime) {
                req.session.error = "Please fill in the booking date, check-in time, and check-out time for the cottage.";
                return res.redirect("/booking");
            }

            // BLOCK MONDAY & TUESDAY
            if (isMondayOrTuesday(bookingDate)) {
                req.session.error = "We are closed every Monday and Tuesday. Please choose a different date.";
                return res.redirect("/booking");
            }

            // Combine into MySQL DATETIME format
            finalCheckin = bookingDate + ' ' + checkinTime + ':00';
            finalCheckout = bookingDate + ' ' + checkoutTime + ':00';

            console.log("🕐 Cottage datetime strings:", { finalCheckin, finalCheckout });

            // Check ALL bookings (pending + approved) for same-day double booking
            const overlapCheck = await dbQuery(`
                SELECT checkin, checkout FROM bookings 
                WHERE roomType = ? AND DATE(checkin) = DATE(?)
                LIMIT 1
            `, [roomType, finalCheckin]);

            if (overlapCheck.length > 0) {
                const dateStr = new Date(bookingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                req.session.error = `"${roomType}" is already booked on ${dateStr}. Please choose another cottage or a different date.`;
                return res.redirect("/booking");
            }

            const roomPrice = roomResults.length > 0 ? parseFloat(roomResults[0].price) : 0;
            totalPrice = roomPrice;
            nights = 0;

        } else {
            // ROOMS: Only check-in date needed — auto-calculate checkout
            if (!checkin) {
                req.session.error = "Please select a check-in date.";
                return res.redirect("/booking");
            }

            // BLOCK MONDAY & TUESDAY for checkin
            if (isMondayOrTuesday(checkin)) {
                req.session.error = "Check-in cannot be on Monday or Tuesday. We are closed those days.";
                return res.redirect("/booking");
            }

            // Auto-calculate checkout (next day, skip Mon/Tue)
            finalCheckin = checkin;
            finalCheckout = getAutoCheckout(checkin);

            console.log("🛏️ Room auto-checkout:", { finalCheckin, finalCheckout });

            // Check ALL bookings (pending + approved) for date overlap
            const overlapCheck = await dbQuery(`
                SELECT checkin, checkout FROM bookings 
                WHERE roomType = ? AND checkin < ? AND checkout > ?
                LIMIT 1
            `, [roomType, finalCheckout, finalCheckin]);

            if (overlapCheck.length > 0) {
                const existing = overlapCheck[0];
                const inStr = new Date(existing.checkin).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const outStr = new Date(existing.checkout).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                req.session.error = `"${roomType}" is already booked from ${inStr} to ${outStr}. Please choose another room or different dates.`;
                return res.redirect("/booking");
            }

            const checkinDate = new Date(finalCheckin);
            const checkoutDate = new Date(finalCheckout);
            nights = Math.max(1, Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24)));
            const roomPrice = roomResults.length > 0 ? parseFloat(roomResults[0].price) : 0;
            totalPrice = roomPrice * nights;
        }

        // Clear verification code after successful booking (one-time use)
        delete req.session.verificationCodes[email];

        await dbQuery(
            "INSERT INTO bookings (name, email, people, checkin, checkout, roomType, requests, status, total_price, nights) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            [name, email, guestCount, finalCheckin, finalCheckout, roomType, requests || null, totalPrice, nights]
        );

        console.log("✅ Saved to DB:", { finalCheckin, finalCheckout, totalPrice });

        const priceLabel = isCottage 
            ? `₱${totalPrice.toLocaleString()} (Flat Rate - Day Use)` 
            : `₱${totalPrice.toLocaleString()} for ${nights} night(s)`;
            
        req.session.msg = `Booking request submitted! ${roomCategory}: ${priceLabel}. Please wait for admin approval.`;
        res.redirect("/booking");

    } catch (err) {
        console.error("❌ SQL Error in /create:", err);
        res.status(500).send("Database Error: " + (err.message || "Unknown error"));
    }
});

router.get("/api/dashboard/stats", checkAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const revenueResults = await dbQuery(
            "SELECT total_amount FROM daily_revenue WHERE revenue_date = ?", 
            [today]
        );
        const dailyRevenue = revenueResults.length > 0 ? revenueResults[0].total_amount : 0;

        const guestResults = await dbQuery(
            "SELECT COUNT(*) as total FROM bookings WHERE status = 'approved'"
        );
        const activeGuests = guestResults[0].total;

        const totalRevenueResults = await dbQuery(
            "SELECT SUM(total_amount) as grand_total FROM daily_revenue"
        );
        const totalRevenue = totalRevenueResults[0].grand_total || 0;

        const totalGuestsResults = await dbQuery(
            "SELECT SUM(guest_count) as total_guests FROM daily_revenue"
        );
        const totalGuestsAllTime = totalGuestsResults[0].total_guests || 0;

        const checkins = await dbQuery(`
            SELECT name, roomType, checkin, status, people 
            FROM bookings 
            ORDER BY id DESC 
            LIMIT 5
        `);

        res.json({ 
            dailyRevenue, 
            activeGuests, 
            totalRevenue,
            totalGuestsAllTime,
            recentCheckins: checkins || [] 
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
                revenue_date,
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


router.use("/", bookingRoutes);

module.exports = router;