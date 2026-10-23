import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Pure display-order fix, no grant/authorization change — part of adding Policy Management/Resource
 * Catalog as real sidebar entries under System Admin, siblings of Role Management.
 *
 * seed-data.ts's SUB_MODULES array was reordered to insert the two new entries right after Role
 * Management (displayOrder 2), shifting Attributes/LFM/Document Set Definition's INTENDED order down
 * by two — but SubModulesService.ensureCriticalDefaults() only ever CREATES a missing row by code; it
 * never updates an existing row's displayOrder. In this already-seeded dev environment, that left
 * LFM and Attributes colliding with the two new rows at the same displayOrder (3 and 4 respectively),
 * with insertion order deciding the tiebreak — the sidebar rendered Lookup Field Master BEFORE Policy
 * Management instead of after it. This migration corrects the three pre-existing rows' displayOrder
 * directly so the real rendered order matches seed-data.ts's intended sequence:
 *   User Management(1) -> Role Management(2) -> Policy Management(3) -> Resource Catalog(4) ->
 *   Attributes(5) -> Lookup Field Master(6) -> Document Set Definition(7)
 * No code/url/icon/isActive change, no RolePermission change — purely cosmetic ordering metadata.
 */
export class FixSystemAdminSubModuleDisplayOrder1792700000000 implements MigrationInterface {
    name = 'FixSystemAdminSubModuleDisplayOrder1792700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE sub_modules SET displayOrder = 5 WHERE code = 'ATTRIBUTES'`);
        await queryRunner.query(`UPDATE sub_modules SET displayOrder = 6 WHERE code = 'LFM'`);
        await queryRunner.query(`UPDATE sub_modules SET displayOrder = 7 WHERE code = 'DOCUMENT_SET_DEFINITION'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE sub_modules SET displayOrder = 3 WHERE code = 'ATTRIBUTES'`);
        await queryRunner.query(`UPDATE sub_modules SET displayOrder = 4 WHERE code = 'LFM'`);
        await queryRunner.query(`UPDATE sub_modules SET displayOrder = 5 WHERE code = 'DOCUMENT_SET_DEFINITION'`);
    }
}
