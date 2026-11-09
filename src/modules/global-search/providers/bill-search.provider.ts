import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bill } from '../../billing-management/entities/bill.entity';
import { BillingManagementService } from '../../billing-management/billing-management.service';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class BillSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'BillSearchProvider';
  private static readonly MODULE_LABEL = 'Billing Management';

  constructor(
    @InjectRepository(Bill) private readonly bills: Repository<Bill>,
    // Reused, not reimplemented — "Overdue" is deliberately never a stored status (see Bill.status's
    // own doc comment); BillingManagementService.getDisplayStatus is the one place that derivation
    // lives, already used by every other bill list/detail read in the app.
    private readonly billingManagement: BillingManagementService,
  ) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.BILLING_VIEW);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    const rows = await applyMultiWordSearch(
      this.bills
        .createQueryBuilder('bill')
        .innerJoin('bill.property', 'property')
        .innerJoin('bill.unit', 'unit')
        .select(['bill.id', 'bill.businessCode', 'bill.status', 'bill.billDueDate', 'property.name', 'unit.unitNumber']),
      ['bill.businessCode', 'property.name', 'unit.unitNumber'],
      term,
    )
      .orderBy('bill.generatedAt', 'DESC')
      .take(limit)
      .getMany();

    return rows.map((bill) => ({
      entityType: 'INVOICE',
      id: String(bill.id),
      module: BillSearchProvider.MODULE_LABEL,
      title: bill.businessCode ?? `Invoice #${bill.id}`,
      description: `${bill.property.name} · Unit ${bill.unit.unitNumber}`,
      status: humanizeEnumValue(this.billingManagement.getDisplayStatus(bill)),
      // No routable per-invoice detail page exists today (CCB_WEB's ManageInvoicesPage opens an
      // InvoiceDetailModal from in-page component state, never a URL param) — this lands the viewer on
      // the Invoices list, where the matched invoice's own business code is visible to open from there,
      // rather than linking to a page that doesn't exist. Revisit once/if a routable detail page ships.
      url: `/billing/invoices`,
    }));
  }
}
