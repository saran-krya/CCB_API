// Shared shape for a module's "field metadata registry" — a single,
// declarative description of a form field's business rules (mandatory-ness,
// numeric/length bounds, display format) that both the DTO validation and
// the frontend UI can be driven from, instead of each maintaining its own
// hand-written copy of the same facts. Only the STATIC, universally-true
// facts belong here; a field whose rule depends on a sibling field's value
// (e.g. "required only when X is enabled") stays as explicit, commented code
// on both sides — see each module's own custom validators/completeness
// checks for those. This type is intentionally just data (no functions), so
// it can be exposed to the frontend as plain JSON with no translation layer.
export interface FieldMetadata {
  // Wizard/form step this field belongs to (1-based), for grouping.
  step: number;
  // Human label — the UI's own copy is still authoritative for anything
  // bespoke; this exists mainly so validation messages and any generic
  // rendering can reference a field by name without a separate lookup.
  label: string;
  // Mandatory to submit/complete, WITHIN whatever context makes this field
  // apply at all (e.g. propertyIds is "required" here even though it only
  // applies when applicability=property — the conditional rendering that
  // already gates its visibility is what supplies the "when", this only
  // answers "and is it mandatory once shown").
  required: boolean;
  // Numeric fields only. allowZero=false means the value must be strictly
  // greater than zero (a core rate/charge, not a fee that can be waived).
  allowZero?: boolean;
  min?: number;
  max?: number;
  // Text fields only.
  minLength?: number;
  maxLength?: number;
  format?: 'currency' | 'percentage' | 'count' | 'text' | 'date' | 'boolean';
}

export type FieldMetadataMap = Record<string, FieldMetadata>;
