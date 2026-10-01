// Only these two are in scope — Billing Cycle is explicitly excluded (it keeps its own existing
// Finance approval screen, untouched by Workflow).
export enum WorkflowType {
  TARIFF = 'TARIFF',
  BILL_RUN = 'BILL_RUN',
}
