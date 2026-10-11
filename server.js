require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require('path');
const app = express();

const MySQLStore = require('express-mysql-session')(session);
const routes = require("./routes");

app.set("view engine", "ejs");
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, "public")));

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Detect if running on Vercel (production) or locally (development)
const isProduction = process.env.NODE_ENV === 'production';

// Only trust proxy in production (Vercel)
if (isProduction) {
    app.set('trust proxy', 1);
}

// Session store options
const sessionStoreOptions = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    connectionLimit: 5,
    createDatabaseTable: true,
    expiration: 1000 * 60 * 60 * 24 * 7,
};

const sessionStore = new MySQLStore(sessionStoreOptions);

app.use(session({
    secret: process.env.SESSION_SECRET || 'kml_resort_top_secret_key',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    name: 'kml.sid',
    proxy: isProduction,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7,
        httpOnly: true,
        secure: isProduction,           // FALSE locally, TRUE on Vercel
        sameSite: isProduction ? 'none' : 'lax'
    }
}));

app.use("/", routes);

app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        console.error('❌ Malformed JSON body on', req.method, req.path, '-', err.message);
        return res.status(400).json({ success: false, message: 'Invalid request format. Please refresh the page and try again.' });
    }
    next(err);
});

app.use((err, req, res, next) => {
    console.error('🔥 Unhandled error on', req.method, req.path, '-', err && err.stack ? err.stack : err);
    if (res.headersSent) return next(err);

    if (req.path.startsWith('/api/')) {
        return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
    res.status(500).send(
        `<h2>Something went wrong</h2><p>Please try again in a moment.</p><a href="/">← Back home</a>`
    );
});

process.on('unhandledRejection', (reason) => {
    console.error('🔥 Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('🔥 Uncaught Exception:', err);
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`🚀 KML Resort is LIVE at: http://localhost:${port}`);
});

module.exports = app;