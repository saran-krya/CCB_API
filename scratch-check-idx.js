const mysql = require("mysql2/promise");
require("dotenv").config({ path: "d:/saran/CCB parent/CCB API/.env" });
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
  });
  for (const t of ["refresh_tokens", "user_devices", "user_login_history"]) {
    const [cols] = await conn.execute(`SHOW COLUMNS FROM ${t} WHERE Field = 'principal_type'`);
    console.log(t, JSON.stringify(cols));
  }
  const [counts] = await conn.execute(`SELECT
    (SELECT COUNT(*) FROM refresh_tokens WHERE principal_type = 'staff') AS rt_staff,
    (SELECT COUNT(*) FROM refresh_tokens WHERE principal_type != 'staff') AS rt_other,
    (SELECT COUNT(*) FROM user_devices WHERE principal_type = 'staff') AS ud_staff,
    (SELECT COUNT(*) FROM user_login_history WHERE principal_type = 'staff') AS ulh_staff
  `);
  console.log(JSON.stringify(counts));
  await conn.end();
})().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
