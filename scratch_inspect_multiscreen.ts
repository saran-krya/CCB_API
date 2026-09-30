import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();
async function main() {
  const ds = new DataSource({
    type: 'mysql', host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
  });
  await ds.initialize();

  // Find sub-modules with MORE THAN ONE screen underneath — the real multi-tab pattern.
  const rows = await ds.query(`
    SELECT sm.id as subModuleId, sm.code as subModuleCode, sm.name as subModuleName,
           s.id as screenId, s.code as screenCode, s.name as screenName
    FROM sub_modules sm
    JOIN screens s ON s.subModuleId = sm.id
    ORDER BY sm.id, s.displayOrder
  `);
  const grouped: Record<string, any[]> = {};
  for (const r of rows) {
    const key = `${r.subModuleCode} (id ${r.subModuleId})`;
    grouped[key] = grouped[key] || [];
    grouped[key].push({ screenId: r.screenId, screenCode: r.screenCode, screenName: r.screenName });
  }
  for (const [subMod, screens] of Object.entries(grouped)) {
    if (screens.length > 1) {
      console.log(`\n=== ${subMod} — ${screens.length} screens ===`);
      console.log(screens);
    }
  }

  await ds.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
