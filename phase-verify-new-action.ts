import { createConnection } from 'typeorm';

async function main() {
  const conn = await createConnection({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'ccb',
    synchronize: false,
    entities: [],
  });

  const action = await conn.query(`SELECT id, code, name, screenId FROM actions WHERE code = 'WORKFLOW_MANAGE_APPROVERS'`);
  console.log('WORKFLOW_MANAGE_APPROVERS action:', JSON.stringify(action, null, 2));

  const grants = await conn.query(
    `SELECT rp.roleId, r.role_name FROM role_permissions rp JOIN roles r ON r.id = rp.roleId JOIN actions a ON a.id = rp.actionId WHERE a.code = 'WORKFLOW_MANAGE_APPROVERS'`,
  );
  console.log('Who holds WORKFLOW_MANAGE_APPROVERS:', JSON.stringify(grants, null, 2));

  await conn.close();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
