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


router.get("/bookings", checkAuth, async (req, res) => {
  const triggerApprove = req.session.triggerApprove || false;
  const gData = {
    name: req.session.guestName || null,
    email: req.session.guestEmail || null,
    room: req.session.guestRoom || null,
    in: req.session.guestIn || null,
    out: req.session.guestOut || null,
    people: req.session.guestPeople || null,
    requests: req.session.guestRequests || null
  };

  ['triggerApprove', 'guestName', 'guestEmail', 'guestRoom', 'guestIn', 'guestOut', 'guestPeople', 'guestRequests'].forEach(key => delete req.session[key]);

  try {
    const bookings = await dbQuery("SELECT * FROM bookings ORDER BY id DESC");
    
    res.render("admin/booking", { 
      bookings: bookings || [],
      triggerApprove, 
      guestName: gData.name, 
      guestEmail: gData.email,
      guestRoom: gData.room, 
      guestIn: gData.in, 
      guestOut: gData.out, 
      guestPeople: gData.people,
      guestRequests: gData.requests
    });
  } catch (err) {
    console.error("❌ SQL Error in /bookings:", err);
    res.status(500).send(`<h2>Database Error</h2><p>${err.message || 'Unknown error'}</p><a href="/admin-dashboard">← Back to Dashboard</a>`);
  }
});


router.post("/approve/:id", checkAuth, async (req, res) => {
  const bookingId = req.params.id;

  try {
    await dbQuery("UPDATE bookings SET status = 'approved' WHERE id = ?", [bookingId]);

    const rows = await dbQuery("SELECT * FROM bookings WHERE id = ?", [bookingId]);

    if (rows && rows.length > 0) {
      const row = rows[0];

      // Add revenue and guest count using helper from index.js
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

router.post("/update/:id", checkAuth, async (req, res) => {
  const bookingId = req.params.id;
  const { name, email, people, checkin, checkout, roomType, requests } = req.body;
  
  try {
    await dbQuery(
      "UPDATE bookings SET name = ?, email = ?, people = ?, checkin = ?, checkout = ?, roomType = ?, requests = ? WHERE id = ?",
      [name, email, people, checkin, checkout, roomType, requests || null, bookingId]
    );
    console.log(`✅ Booking #${bookingId} updated.`);
    res.redirect("/bookings");
  } catch (err) {
    console.error("❌ Update Error:", err);
    res.status(500).send("Update failed: " + (err.message || "Unknown error"));
  }
});


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