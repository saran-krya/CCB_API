import { SORT_ORDER } from '../../common/constants/sort.constants';

/** The effect of a policy statement. `Allow` is the only effect that exists — nothing can write another value. */
export const POLICY_EFFECT = {
  ALLOW: 'Allow',
} as const;

/** Load an inline policy together with its statements (and each statement's resource). */
export const WITH_STATEMENTS = { statements: { resource: true } } as const;

/** Statements come back in the order they were saved, so an edit screen always lists them the same way. */
export const STATEMENTS_IN_SAVED_ORDER = { id: SORT_ORDER.ASC, statements: { id: SORT_ORDER.ASC } } as const;
