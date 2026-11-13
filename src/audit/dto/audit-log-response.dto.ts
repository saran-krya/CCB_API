import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';

export interface AuditLogActor {
  id: number;
  /** "First Last", or the email when the account has no name; `null` when the account no longer exists. */
  name: string | null;
  email: string | null;
}

export interface AuditLogListItem {
  id: number;
  createdAt: string;
  moduleName: string;
  moduleLabel: string;
  action: string;
  actionLabel: string;
  /** The affected record's id within `moduleName`, when the entry concerns one specific record. */
  entityId: number | null;
  /** `null` for an entry with no acting user (a system job, or a sign-in attempt before any user was known). */
  performedBy: AuditLogActor | null;
  /** Whether the entry stored an old and/or new value worth opening. */
  hasDetails: boolean;
}

export interface AuditLogDetail extends AuditLogListItem {
  /** Parsed from the stored JSON (raw text if it was not JSON); secret-looking string values are masked. */
  oldValue: unknown;
  newValue: unknown;
}

export interface AuditLogFilterOption {
  value: string;
  label: string;
}

export interface AuditLogListResponse extends PaginatedResult<AuditLogListItem> {
  meta: {
    modules: AuditLogFilterOption[];
    actions: AuditLogFilterOption[];
  };
}
