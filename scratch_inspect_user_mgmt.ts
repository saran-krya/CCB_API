import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();
async function main() {
  const ds = new DataSource({
    type: 'mysql', host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
  });
  await ds.initialize();

  const actions = await ds.query(`
    SELECT a.id, a.code, a.name, a.screenId, s.code as screenCode, a.parentActionId
    FROM actions a JOIN screens s ON s.id = a.screenId
    WHERE s.subModuleId = 2
    ORDER BY s.id, a.displayOrder
  `);
  console.log(actions);

  await ds.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
