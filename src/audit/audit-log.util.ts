/** Placeholder the viewer shows instead of a secret-looking value. */
export const AUDIT_REDACTED_VALUE = '[redacted]';

/** Keys whose STRING value is never shown by the audit viewer, whatever a writer stored. Credential audit rows are written
 *  without passwords or hashes (see AUDIT_CREDENTIAL_ACTION), so this is defence in depth: a future writer that stores one by
 *  mistake still cannot leak it through the viewer. Only strings are masked — a boolean such as `mustChangePassword` is a
 *  fact worth reading, not a secret. */
const SENSITIVE_KEY = /pass(word|phrase)|secret|token|hash|otp|api[-_]?key|authorization|credential/i;

const MAX_REDACTION_DEPTH = 10;

/** "BillRun" → "Bill Run", "billing_cycles" → "Billing Cycles", "registration-requests" → "Registration Requests",
 *  "ADMIN_RESET_PASSWORD" → "Admin Reset Password". Display only: filters always use the stored value. */
export function humanizeAuditToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function redact(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACTION_DEPTH) return AUDIT_REDACTED_VALUE;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SENSITIVE_KEY.test(key) && typeof inner === 'string' && inner !== '' ? AUDIT_REDACTED_VALUE : redact(inner, depth + 1),
      ]),
    );
  }
  return value;
}

/** An audit row's stored `old_value` / `new_value` text as something the viewer can render: parsed JSON (writers store
 *  `JSON.stringify(...)`), or the raw text when it is not JSON, with secret-looking string values masked. `null` stays `null`. */
export function parseAuditValue(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return redact(JSON.parse(raw), 0);
  } catch {
    return raw;
  }
}
