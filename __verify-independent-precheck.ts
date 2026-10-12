import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DataSource } from 'typeorm';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ds = app.get(DataSource);

  const def = await ds.query(
    `SELECT id, workflowType, status FROM workflow_definitions WHERE workflowType = 'TARIFF'`,
  );
  console.log('TARIFF workflow_definitions:', JSON.stringify(def, null, 2));

  const activeTariffs = await ds.query(
    `SELECT id, masterId, name, status, applicability, effectiveFrom, propertyType FROM tariff_versions WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 5`,
  );
  console.log('ACTIVE tariff_versions (candidates to clone):', JSON.stringify(activeTariffs, null, 2));

  const maxTv = await ds.query(`SELECT MAX(id) as maxId FROM tariff_versions`);
  const maxWi = await ds.query(`SELECT MAX(id) as maxId FROM workflow_instances`);
  console.log('max tariff_versions.id (before test):', JSON.stringify(maxTv));
  console.log('max workflow_instances.id (before test):', JSON.stringify(maxWi));

  await app.close();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
