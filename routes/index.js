const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const bookingRoutes = require("./bookings");
const getDb = () => require("../config/database");

const checkAuth = (req, res, next) => req.session.isLoggedIn ? next() : res.redirect("/login");

const dbQuery = (sql, params = []) => new Promise((resolve, reject) => {
    getDb().query(sql, params, (err, results) => err ? reject(err) : resolve(results));
});

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
router.get("/dinning", (req, res) => res.render("user/dinning"));
router.get("/amenities", (req, res) => res.render("user/amenities"));
router.get("/location", (req, res) => res.render("user/location"));
router.get("/live-map", (req, res) => res.render("admin/live-map"));

router.get("/booking", async (req, res) => {
    const msg = req.session.msg || null;
    ['msg','triggerApprove','guestName','guestEmail'].forEach(k => delete req.session[k]);

    try {
        const rooms = await dbQuery("SELECT * FROM rooms WHERE status = 'available' ORDER BY category, name");
        res.render("user/booking", { message: msg, rooms: rooms || [] });
    } catch (err) {
        console.error("❌ Error loading accommodations:", err);
        res.render("user/booking", { message: msg, rooms: [] });
    }
});

function buildWhere(baseSql, filters) {
    let sql = baseSql, params = [];
    for (const [key, val] of Object.entries(filters)) {
        if (!val || val === 'all') continue;
        if (key === 'search') { sql += " AND (name LIKE ? OR room_id LIKE ?)"; params.push(`%${val}%`, `%${val}%`); }
        else if (key === 'foodSearch') { sql += " AND (name LIKE ? OR description LIKE ? OR category LIKE ?)"; params.push(`%${val}%`, `%${val}%`, `%${val}%`); }
        else if (key === 'mountainSearch') { sql += " AND (title LIKE ? OR location LIKE ?)"; params.push(`%${val}%`, `%${val}%`); }
        else { sql += " AND category = ?"; params.push(val); }
    }
    return { sql, params };
}

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

router.get("/api/dashboard/stats", checkAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const revenueResults = await dbQuery("SELECT total_amount FROM daily_revenue WHERE revenue_date = ?", [today]);
        const dailyRevenue = revenueResults.length > 0 ? revenueResults[0].total_amount : 0;

        const guestResults = await dbQuery("SELECT COUNT(*) as total FROM bookings WHERE status = 'approved'");
        const activeGuests = guestResults[0].total;
        const checkins = await dbQuery(`
            SELECT name, roomType, checkin, status, people 
            FROM bookings 
            ORDER BY id DESC 
            LIMIT 5
        `);

        res.json({ dailyRevenue, activeGuests, recentCheckins: checkins || [] });
    } catch (err) {
        console.error("❌ Dashboard stats error:", err);
        res.status(500).json({ error: "Failed to load dashboard stats" });
    }
});

router.post("/api/dashboard/reset-revenue", checkAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        await dbQuery(
            "INSERT INTO daily_revenue (revenue_date, total_amount) VALUES (?, 0) ON DUPLICATE KEY UPDATE total_amount = 0, last_reset = NOW()",
            [today]
        );
        res.json({ success: true, message: "Daily revenue reset to ₱0.00" });
    } catch (err) {
        console.error("❌ Reset revenue error:", err);
        res.status(500).json({ error: "Failed to reset revenue" });
    }
});


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
    const { name, category, price, popularity, description, stock_status, stock_qty, image } = req.body;
    
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
            "INSERT INTO food_items (food_id, name, category, price, popularity, description, stock_status, stock_qty, image, added_to_gallery) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
            [food_id, name, category, price, popularity, description, stock_status, stock_qty, image]
        );
        
        res.json({ success: true, id: result.insertId, food_id });
    } catch (err) { 
        console.error("❌ Error adding food item:", err); 
        res.status(500).json({ error: "Failed to add food item", details: err.message }); 
    }
});

router.put("/api/food-items/:id", checkAuth, async (req, res) => {
    const { name, category, price, popularity, description, stock_status, stock_qty } = req.body;
    try {
        await dbQuery("UPDATE food_items SET name=?, category=?, price=?, popularity=?, description=?, stock_status=?, stock_qty=? WHERE food_id=?",
            [name, category, price, popularity, description, stock_status, stock_qty, req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error updating food item:", err); res.status(500).json({ error: "Failed to update food item" }); }
});

router.delete("/api/food-items/:id", checkAuth, async (req, res) => {
    try {
        await dbQuery("DELETE FROM food_items WHERE food_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error("❌ Error deleting food item:", err); res.status(500).json({ error: "Failed to delete food item" }); }
});

router.get("/api/gallery", async (req, res) => {
    const { type } = req.query;
    const db = getDb();

    const run = (sql) => new Promise((resolve, reject) => db.query(sql, (err, r) => err ? reject(err) : resolve(r || [])));

    try {
        const [rooms, mountainViews, dining] = await Promise.all([
            (!type || type === 'all' || type === 'rooms') ? run("SELECT room_id as id, name, category, price, occupancy, status, image, 'room' as type FROM rooms WHERE added_to_gallery = 1") : Promise.resolve([]),
            (!type || type === 'all' || type === 'mountain') ? run("SELECT view_id as id, title as name, location, image, 'mountain' as type FROM mountain_views") : Promise.resolve([]),
            (!type || type === 'all' || type === 'dining') ? run("SELECT food_id as id, name, category, price, popularity, description, stock_status, stock_qty, image, 'dining' as type FROM food_items WHERE added_to_gallery = 1") : Promise.resolve([])
        ]);
        res.json({ rooms, mountainViews, dining });
    } catch (err) { console.error("❌ Error fetching gallery data:", err); res.status(500).json({ error: "Failed to fetch gallery data" }); }
});

router.post("/create", async (req, res) => {
    const { name, email, people, checkin, checkout, roomType, requests } = req.body;

    try {
        const checkinDate = new Date(checkin);
        const checkoutDate = new Date(checkout);
        const nights = Math.max(1, Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24)));

        const roomResults = await dbQuery("SELECT price, category FROM rooms WHERE name = ? LIMIT 1", [roomType]);
        const roomPrice = roomResults.length > 0 ? roomResults[0].price : 0;
        const roomCategory = roomResults.length > 0 ? roomResults[0].category : 'Room';

        const totalPrice = roomPrice * nights;

        await dbQuery(
            "INSERT INTO bookings (name, email, people, checkin, checkout, roomType, requests, status, total_price, nights) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            [name, email, people, checkin, checkout, roomType, requests || null, totalPrice, nights]
        );

        req.session.msg = `Booking request submitted! ${roomCategory}: ₱${totalPrice.toLocaleString()} for ${nights} night(s). Please wait for admin approval.`;
        res.redirect("/booking");
    } catch (err) {
        console.error("❌ SQL Error in /create:", err);
        res.status(500).send("Database Error: " + (err.message || "Unknown error"));
    }
});


router.use("/", bookingRoutes);

module.exports = router;