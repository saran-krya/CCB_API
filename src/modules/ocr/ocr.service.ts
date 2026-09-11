import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AttributeService } from '../attribute/attribute.service';

/**
 * ConverseZen OCR proxy — mirrors the CentriZen ConverseZen Integration Spec §4/§6/§9. Holds the
 * API key + per-document-type agent IDs server-side; the frontend never sees either. Every value
 * comes from environment variables and is genuinely absent until a real deployment configures it —
 * this module reports OCR_NOT_CONFIGURED honestly rather than fabricating a working extractor.
 */

const AGENT_ENV_VAR_BY_DOCUMENT_TYPE: Record<string, string> = {
  'Emirates ID': 'CONVERSEZEN_AGENT_EMIRATES_ID',
  "Owner's Emirates ID": 'CONVERSEZEN_AGENT_EMIRATES_ID',
  "Tenant's Emirates ID": 'CONVERSEZEN_AGENT_EMIRATES_ID',
  Passport: 'CONVERSEZEN_AGENT_PASSPORT',
  'TRN Certificate': 'CONVERSEZEN_AGENT_TRN',
  'Trade License': 'CONVERSEZEN_AGENT_TRADE_LICENSE',
};

const EXTRACTION_TIMEOUT_MS = 90_000;
const DEFAULT_BASE_URL = 'http://localhost:3001';

export interface OcrExtractionField {
  fieldName: string;
  extractedValue: string | null;
  confidence: number | null;
}

export type OcrOutcome =
  | {
      ok: true;
      status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
      runId: string | null;
      fields: OcrExtractionField[];
      reason?: string;
    }
  | {
      ok: false;
      code:
        | 'OCR_DATA_ENTRY_DISABLED'
        | 'DOCUMENT_TYPE_NOT_SUPPORTED'
        | 'OCR_NOT_CONFIGURED'
        | 'OCR_UPSTREAM_UNREACHABLE'
        | 'OCR_UPSTREAM_TIMEOUT'
        | 'OCR_RATE_LIMITED'
        | 'OCR_AUTH_FAILED'
        | 'OCR_AGENT_UNAVAILABLE'
        | 'DOCUMENT_REJECTED'
        | 'OCR_UPSTREAM_ERROR';
      message: string;
    };

function redactAgentId(message: string, agentId: string): string {
  if (!agentId) return message;
  return message.split(agentId).join('[agent]');
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly attributes: AttributeService,
  ) {}

  isDocumentTypeSupported(documentType: string): boolean {
    return documentType in AGENT_ENV_VAR_BY_DOCUMENT_TYPE;
  }

  async extract(documentType: string, file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<OcrOutcome> {
    const ocrEnabled = await this.attributes.isMandatory('OCR_DATA_ENTRY_ENABLED');
    if (!ocrEnabled) {
      return {
        ok: false,
        code: 'OCR_DATA_ENTRY_DISABLED',
        message: 'OCR-based data entry is switched off — enter the document details manually.',
      };
    }

    const envVar = AGENT_ENV_VAR_BY_DOCUMENT_TYPE[documentType];
    if (!envVar) {
      return {
        ok: false,
        code: 'DOCUMENT_TYPE_NOT_SUPPORTED',
        message: `Automatic extraction is not available for "${documentType}". Enter the details manually.`,
      };
    }

    const agentId = this.config.get<string>(envVar)?.trim();
    if (!agentId) {
      this.logger.warn(`No agent configured for "${documentType}" — ${envVar} is unset`);
      return {
        ok: false,
        code: 'DOCUMENT_TYPE_NOT_SUPPORTED',
        message: `Automatic extraction is not available for "${documentType}". Enter the details manually.`,
      };
    }

    const apiKey = this.config.get<string>('CONVERSEZEN_API_KEY')?.trim();
    if (!apiKey) {
      return {
        ok: false,
        code: 'OCR_NOT_CONFIGURED',
        message: 'Document extraction is not configured on this server.',
      };
    }

    const baseUrl = (this.config.get<string>('CONVERSEZEN_BASE_URL')?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const url = `${baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}/ocr-extractions`;

    const form = new FormData();
    const bytes = new Uint8Array(file.buffer);
    form.append('file', new Blob([bytes], { type: file.mimetype }), file.originalname || 'document');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Idempotency-Key': randomUUID(),
        },
        body: form,
        signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, code: 'OCR_UPSTREAM_TIMEOUT', message: 'The document extraction service did not respond in time. Try again.' };
      }
      return { ok: false, code: 'OCR_UPSTREAM_UNREACHABLE', message: 'The document extraction service could not be reached. Try again shortly.' };
    }

    let body: any;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: 'OCR_UPSTREAM_ERROR', message: 'The document extraction service returned an unreadable response.' };
    }

    const upstreamError = body?.error;
    if (upstreamError) {
      const rawMessage: string = typeof upstreamError.message === 'string' ? upstreamError.message : '';
      const mentionsAgent = !!agentId && rawMessage.includes(agentId);
      if (response.status === 429) {
        return { ok: false, code: 'OCR_RATE_LIMITED', message: 'Too many extraction requests right now. Try again shortly.' };
      }
      if (response.status === 401) {
        return { ok: false, code: 'OCR_AUTH_FAILED', message: 'Document extraction is not configured correctly on this server.' };
      }
      if (response.status === 403 || response.status === 404 || mentionsAgent) {
        return { ok: false, code: 'OCR_AGENT_UNAVAILABLE', message: 'The extraction agent for this document type is unavailable.' };
      }
      if (response.status === 400) {
        return { ok: false, code: 'DOCUMENT_REJECTED', message: redactAgentId(rawMessage, agentId) || 'The document was rejected.' };
      }
      return { ok: false, code: 'OCR_UPSTREAM_ERROR', message: 'The document extraction service returned an unexpected error.' };
    }

    const data = body?.data;
    if (!data || (data.status !== 'SUCCEEDED' && data.status !== 'PARTIAL' && data.status !== 'FAILED')) {
      return { ok: false, code: 'OCR_UPSTREAM_ERROR', message: 'The document extraction service returned an unrecognised outcome.' };
    }

    if (data.status === 'FAILED') {
      return {
        ok: false,
        code: 'DOCUMENT_REJECTED',
        message: typeof data.error === 'string' ? redactAgentId(data.error, agentId) : 'The document could not be read. Try a clearer scan, or enter the details manually.',
      };
    }

    const rawFields: Record<string, unknown> = data.fields ?? {};
    const confidence: Record<string, number> = data.confidence ?? {};
    const fields: OcrExtractionField[] = Object.entries(rawFields).map(([fieldName, value]) => ({
      fieldName,
      extractedValue: value == null ? null : String(value),
      confidence: typeof confidence[fieldName] === 'number' ? confidence[fieldName] : null,
    }));

    return {
      ok: true,
      status: data.status,
      runId: typeof data.runId === 'string' ? data.runId : null,
      fields,
      reason: data.status === 'PARTIAL' && typeof data.error === 'string' ? redactAgentId(data.error, agentId) : undefined,
    };
  }
}
