// Temporary, isolated SMTP test — mirrors MailService.getTransporter()'s exact config-reading
// logic, but calls nodemailer directly. No app modules loaded, no DB touched, no registration
// approval flow triggered. Deleted immediately after this test runs.
require('dotenv').config();
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const port = process.env.SMTP_PORT;
const user = process.env.SMTP_USER;
const password = process.env.SMTP_PASSWORD;

console.log('--- SMTP config being tested (password withheld) ---');
console.log('SMTP_HOST:', host);
console.log('SMTP_PORT:', port);
console.log('SMTP_USER:', user);
console.log('SMTP_PASSWORD: [' + (password ? password.length : 0) + ' chars, not printed]');
console.log('');

if (!host || !port || !user || !password) {
  console.error('FAILED: one or more SMTP_* env vars are missing.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port: Number(port),
  secure: Number(port) === 465,
  auth: { user, pass: password },
});

(async () => {
  try {
    console.log('Calling transporter.verify() — pure auth check, no email is sent...');
    await transporter.verify();
    console.log('');
    console.log('RESULT: AUTH SUCCEEDED');
  } catch (e) {
    console.log('');
    console.log('RESULT: AUTH FAILED');
    console.log('error.code:', e.code);
    console.log('error.responseCode:', e.responseCode);
    console.log('error.command:', e.command);
    console.log('error.message:', e.message);
  }
})();
