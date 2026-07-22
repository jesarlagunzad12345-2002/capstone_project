require('dotenv').config();
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

// Check if CA certificate file exists (for Aiven)
let sslConfig = {
    rejectUnauthorized: true
};

// Try to read Aiven CA certificate if it exists
const caCertPath = path.join(__dirname, 'ca.pem');
if (fs.existsSync(caCertPath)) {
    sslConfig.ca = fs.readFileSync(caCertPath);
}

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: sslConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) {
        console.error("❌ Database connection failed: " + err.message);
        return;
    }
    console.log("✅ Connected to Aiven MySQL Database.");
    connection.release();
});

module.exports = db;