/** Turns a stored enum value such as "active" or "pending_review" into the display label every list
 *  page already shows a user ("Active", "Pending Review") — never the raw stored value. Null/undefined
 *  in, undefined out, so a caller can chain it straight onto an optional column without its own guard. */
export function humanizeEnumValue(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}
