import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

/** SQL expression (evaluated per row, in the UPDATE) giving a soft-deleted row's unique text value a
 *  tombstone that cannot collide with anything live: the original (shortened to fit) plus its own id. */
const tombstone = (column: string, keepChars: number) => `CONCAT(LEFT(\`${column}\`, ${keepChars}), ' [deleted #', \`id\`, ']')`;

export interface ReleaseOptions {
  /** How the freed value is replaced. `text` (default) = original + " [deleted #<id>]"; `null` = set the
   *  column to NULL (for nullable unique columns such as a mobile number or employee code). */
  replaceWith?: 'text' | 'null';
  /** Characters of the original value kept in the `text` tombstone; must leave room for the suffix
   *  inside the column's length. */
  keepChars?: number;
  /** Replacement for an email-shaped column: a syntactically valid, unroutable address unique per row. */
  email?: boolean;
}

/**
 * Soft delete keeps the row, and with it every UNIQUE value the row held — so a deleted role's name, a
 * deleted policy's name or a deleted user's email could never be reused, and the next create failed at
 * the database index even though the application-level duplicate check (which, correctly, ignores
 * deleted rows) had passed.
 *
 * Call this inside the SAME transaction as the insert/update that wants `value`: it renames only
 * soft-deleted rows currently holding it (never a live row, never `exceptId`), so the value is free by the
 * time the write runs. Nothing is touched unless there is a conflict, which keeps deleted rows readable
 * as they were until someone actually reuses the value. Matching follows the column's own collation, i.e.
 * exactly what the unique index treats as equal (case/accent-insensitive in MySQL). Returns how many
 * deleted rows were released.
 */
export async function releaseSoftDeletedUnique(
  manager: EntityManager,
  entity: EntityTarget<ObjectLiteral>,
  property: string,
  value: string | null | undefined,
  options: ReleaseOptions & { exceptId?: number } = {},
): Promise<number> {
  if (value === undefined || value === null || value === '') return 0;

  const metadata = manager.connection.getMetadata(entity);
  const column = metadata.findColumnWithPropertyName(property);
  const deletedAt = metadata.deleteDateColumn;
  if (!column || !deletedAt) throw new Error(`releaseSoftDeletedUnique: ${metadata.name}.${property} is not a soft-deletable unique column`);

  const replacement = options.email
    ? "CONCAT('deleted-', `id`, '@deleted.invalid')"
    : options.replaceWith === 'null'
      ? 'NULL'
      : tombstone(column.databaseName, options.keepChars ?? 50);

  const qb = manager
    .createQueryBuilder()
    .update(entity)
    .set({ [property]: () => replacement })
    .where(`\`${deletedAt.databaseName}\` IS NOT NULL`)
    .andWhere(`\`${column.databaseName}\` = :value`, { value });
  if (options.exceptId !== undefined) qb.andWhere('`id` <> :exceptId', { exceptId: options.exceptId });

  const result = await qb.execute();
  return result.affected ?? 0;
}
