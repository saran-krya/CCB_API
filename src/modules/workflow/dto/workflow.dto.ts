// The three domains Workflow can orchestrate. Each remains fully owned by its own domain service
// (TariffService/BillRunService/BillingCycleService) — Workflow only gates WHEN the existing
// approve()/reject() may run, never replaces the state change itself. See WorkflowOrchestrationService's
// own doc comment.
export enum WorkflowType {
  TARIFF = 'TARIFF',
  BILL_RUN = 'BILL_RUN',
  BILLING_CYCLE = 'BILLING_CYCLE',
}
