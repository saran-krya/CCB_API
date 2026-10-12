import { AppDataSource } from './src/config/data-source';

async function main() {
  await AppDataSource.initialize();

  const db = await AppDataSource.query('SELECT DATABASE() AS db');
  console.log('CONNECTED_DB:', JSON.stringify(db));

  const tableExists = await AppDataSource.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflow_instances'`,
  );
  console.log('TABLE_EXISTS_CHECK:', JSON.stringify(tableExists));

  const totalAllTypes = await AppDataSource.query('SELECT COUNT(*) AS cnt FROM workflow_instances');
  console.log('TOTAL_ROWS_ALL_TYPES:', JSON.stringify(totalAllTypes));

  const totalTariffOrBillRun = await AppDataSource.query(
    `SELECT COUNT(*) AS cnt FROM workflow_instances WHERE workflowType IN ('TARIFF', 'BILL_RUN')`,
  );
  console.log('TOTAL_ROWS_TARIFF_OR_BILL_RUN:', JSON.stringify(totalTariffOrBillRun));

  const countsByTypeStatus = await AppDataSource.query(
    `SELECT workflowType, status, COUNT(*) AS cnt FROM workflow_instances WHERE workflowType IN ('TARIFF', 'BILL_RUN') GROUP BY workflowType, status`,
  );
  console.log('COUNTS_BY_TYPE_STATUS:', JSON.stringify(countsByTypeStatus));

  const allTypes = await AppDataSource.query('SELECT DISTINCT workflowType FROM workflow_instances');
  console.log('ALL_WORKFLOW_TYPES_IN_TABLE:', JSON.stringify(allTypes));

  const stepRowCount = await AppDataSource.query('SELECT COUNT(*) AS cnt FROM workflow_instance_steps');
  console.log('TOTAL_STEP_ROWS:', JSON.stringify(stepRowCount));

  const defLevelCount = await AppDataSource.query('SELECT COUNT(*) AS cnt FROM workflow_definition_levels');
  console.log('TOTAL_DEFINITION_LEVEL_ROWS:', JSON.stringify(defLevelCount));

  const activeDefCount = await AppDataSource.query(
    `SELECT workflowType, COUNT(*) AS cnt FROM workflow_definitions WHERE status = 'ACTIVE' GROUP BY workflowType`,
  );
  console.log('ACTIVE_DEFINITIONS_BY_TYPE:', JSON.stringify(activeDefCount));

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
