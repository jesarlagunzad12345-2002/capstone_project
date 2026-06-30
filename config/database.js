const mysql = require("mysql2");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "Kml_resort321",
  database: "capstone",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database connection failed: " + err.message);
    return;
  }
  console.log("✅ Connected to MySQL Database Pool.");
  connection.release();
});

module.exports = db;