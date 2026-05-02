// const bcrypt = require('bcrypt');

// const password = 'secure_password123';
// const saltRounds = 10;

// bcrypt.hash(password, saltRounds, (err, hash) => {
//     if (err) {
//         console.error('Error hashing password:', err);
//         return;
//     }
//     console.log('Hashed password:', hash);
//     console.log('\nRun this SQL to insert admin:');
//     console.log(`INSERT INTO admin (username, password_hash) VALUES ('kml_admin', '${hash}');`);
// });