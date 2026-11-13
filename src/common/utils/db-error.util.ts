/** Whether a database error is MySQL's "duplicate entry for a unique key" (a race the earlier existence check cannot see). */
export function isDuplicateKeyError(error: unknown): boolean {
  const candidate = error as { code?: string; driverError?: { code?: string } } | null | undefined;
  return candidate?.code === 'ER_DUP_ENTRY' || candidate?.driverError?.code === 'ER_DUP_ENTRY';
}
