export interface FieldMetadata {
  step: number;
  label: string;
  required: boolean;
  allowZero?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  format?: 'currency' | 'percentage' | 'count' | 'text' | 'date' | 'boolean';
}

export type FieldMetadataMap = Record<string, FieldMetadata>;
