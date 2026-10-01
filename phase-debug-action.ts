import { createConnection } from 'typeorm';

async function main() {
  const conn = await createConnection({
    type: 'mysql', host: process.env.DB_HOST, port: Number(process.env.DB_PORT), username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, synchronize: false, entities: [],
  });

  const workflowView = await conn.query(`SELECT id, code, name FROM actions WHERE code = 'WORKFLOW_VIEW'`);
  console.log('WORKFLOW_VIEW action:', JSON.stringify(workflowView));

  const screen = await conn.query(`SELECT id, code, name FROM screens WHERE code = 'WORKFLOW'`);
  console.log('WORKFLOW screen:', JSON.stringify(screen));

  const byName = await conn.query(`SELECT id, code, name FROM actions WHERE name = 'Manage Workflow Approvers'`);
  console.log('By name match:', JSON.stringify(byName));

  await conn.close();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
