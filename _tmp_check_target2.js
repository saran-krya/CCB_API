const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: '172.20.107.17', port: 3306, user: 'ccb_user', password: 'krya@2026',
    connectTimeout: 8000,
  });
  console.log('Connected successfully.');

  const [dbs] = await conn.query('SHOW DATABASES');
  console.log('Databases visible to this user:', dbs.map(d => Object.values(d)[0]));

  await conn.end();
}
main().catch(e => { console.error('FAILED:', e.code || e.message); process.exit(1); });
