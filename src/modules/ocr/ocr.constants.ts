/** Outcome statuses reported by the document-extraction service. */
export const OCR_STATUS = {
  SUCCEEDED: 'SUCCEEDED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
} as const;

export type OcrStatus = (typeof OCR_STATUS)[keyof typeof OCR_STATUS];

/** Error codes the OCR endpoint returns to the web app. They are part of the API contract: the client switches on them. */
export const OCR_ERROR_CODE = {
  OCR_DATA_ENTRY_DISABLED: 'OCR_DATA_ENTRY_DISABLED',
  DOCUMENT_TYPE_NOT_SUPPORTED: 'DOCUMENT_TYPE_NOT_SUPPORTED',
  OCR_NOT_CONFIGURED: 'OCR_NOT_CONFIGURED',
  OCR_UPSTREAM_UNREACHABLE: 'OCR_UPSTREAM_UNREACHABLE',
  OCR_UPSTREAM_TIMEOUT: 'OCR_UPSTREAM_TIMEOUT',
  OCR_RATE_LIMITED: 'OCR_RATE_LIMITED',
  OCR_AUTH_FAILED: 'OCR_AUTH_FAILED',
  OCR_AGENT_UNAVAILABLE: 'OCR_AGENT_UNAVAILABLE',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  OCR_UPSTREAM_ERROR: 'OCR_UPSTREAM_ERROR',
} as const;

export type OcrErrorCode = (typeof OCR_ERROR_CODE)[keyof typeof OCR_ERROR_CODE];
