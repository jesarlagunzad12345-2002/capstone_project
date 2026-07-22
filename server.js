const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const app = express();

const routes = require("./routes");

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));  // ← ADDED limit
app.use(express.json({ limit: '10mb' }));  // ← ADDED limit

app.use(session({
  secret: 'kml_resort_top_secret_key',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 3600000 }
}));

app.use("/", routes);

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`🚀 KML Resort is LIVE at: http://localhost:${port}`);
});


module.exports = app;