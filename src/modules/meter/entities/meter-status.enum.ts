// Shared by MasterMeter and SubMeter — kept in its own file (no circular
// dependency risk) since both entities need it in a @Column decorator.
export enum MeterStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}
