import { AppDataSource } from './src/config/data-source';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './src/modules/workflow/entities/workflow-definition.entity';
import { WorkflowDefinitionLevel } from './src/modules/workflow/entities/workflow-definition-level.entity';
import { Role } from './src/modules/role/entities/role.entity';

async function main() {
  await AppDataSource.initialize();

  const defRepo = AppDataSource.getRepository(WorkflowDefinition);
  const levelRepo = AppDataSource.getRepository(WorkflowDefinitionLevel);
  const roleRepo = AppDataSource.getRepository(Role);

  // Mirror getActiveDefinition's own query exactly: workflowType + status=ACTIVE.
  const activeDef = await defRepo.findOne({ where: { workflowType: 'TARIFF' as any, status: WorkflowDefinitionStatus.ACTIVE } });

  if (!activeDef) {
    console.log('RESULT: NO ACTIVE workflow_definitions row for workflowType=TARIFF');
  } else {
    console.log('RESULT: ACTIVE workflow_definitions row EXISTS for workflowType=TARIFF');
    console.log('Definition:', { id: activeDef.id, version: activeDef.version, status: activeDef.status, createdBy: activeDef.createdBy });

    const levels = await levelRepo.find({ where: { definitionId: activeDef.id }, order: { levelOrder: 'ASC' } });
    console.log(`Levels (${levels.length}):`);
    for (const lvl of levels) {
      const role = await roleRepo.findOne({ where: { id: lvl.roleId } });
      console.log({
        levelOrder: lvl.levelOrder,
        roleId: lvl.roleId,
        roleName: (role as any)?.roleName ?? (role as any)?.name ?? null,
        department: lvl.department,
        slaValue: lvl.slaValue,
        slaUnit: lvl.slaUnit,
        onBreach: lvl.onBreach,
      });
    }

    // Also independently cross-check: any OTHER definitions (DRAFT/ARCHIVED) for TARIFF, to confirm
    // uniqueness of the ACTIVE row (sanity check on the "exactly one ACTIVE" invariant documented
    // in workflow-definition.entity.ts).
    const allTariffDefs = await defRepo.find({ where: { workflowType: 'TARIFF' as any } });
    console.log(`\nAll workflow_definitions rows for TARIFF (any status): ${allTariffDefs.length}`);
    for (const d of allTariffDefs) {
      console.log({ id: d.id, version: d.version, status: d.status });
    }
  }

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
