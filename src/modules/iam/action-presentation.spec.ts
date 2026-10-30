import { describeAction, getAccessLevel } from './action-presentation';

// The access-level classification and short action labels used to live in the web app; the API owns them now.
describe('action presentation', () => {
  it('classifies view/list codes as Read, and everything state-changing as Write', () => {
    expect(getAccessLevel('VIEW_USER')).toBe('read');
    expect(getAccessLevel('TARIFF_VIEW')).toBe('read');
    expect(getAccessLevel('EDIT_USER')).toBe('write');
    expect(getAccessLevel('BILLING_CYCLE_APPROVE')).toBe('write');
  });

  it('reserves Manage access for actions that configure who has access', () => {
    expect(getAccessLevel('WORKFLOW_MANAGE_APPROVERS')).toBe('permissions');
    expect(getAccessLevel('TARIFF_APPROVE')).toBe('write');
  });

  it('sends the level label and its sort order (Read < Write < Manage access)', () => {
    const read = describeAction('VIEW_USER', 'View User');
    const write = describeAction('EDIT_USER', 'Edit User');
    const permissions = describeAction('WORKFLOW_MANAGE_APPROVERS', 'Manage Approvers');
    expect([read.accessLevelLabel, write.accessLevelLabel, permissions.accessLevelLabel]).toEqual([
      'Read',
      'Write',
      'Manage access',
    ]);
    expect(read.accessLevelOrder).toBeLessThan(write.accessLevelOrder);
    expect(write.accessLevelOrder).toBeLessThan(permissions.accessLevelOrder);
  });

  it('shortens only the allowlisted codes and leaves every other name untouched', () => {
    expect(describeAction('TARIFF_VIEW', 'View Tariff Detail').displayLabel).toBe('View');
    expect(describeAction('CREATE_USER', 'Create User').displayLabel).toBe('Create');
    expect(describeAction('SOME_OTHER_CODE', 'Some Other Thing').displayLabel).toBe('Some Other Thing');
  });
});
