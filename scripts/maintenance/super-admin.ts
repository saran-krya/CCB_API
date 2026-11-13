/**
 * The installation's SUPER_ADMIN — creating the first one, and getting one back. Run on the SERVER by the person who owns the installation
 * (it needs the database credentials in the environment file); it is deliberately NOT a web route, so nobody who can merely reach the
 * application can use it. This is the "explicit, secure recovery process" for an installation that has no usable administrator:
 *
 *   - the first administrator of an installation started with BOOTSTRAP_SEED_ADMIN=false (the role exists, nobody holds it);
 *   - every SUPER_ADMIN deactivated, or the only one has lost their password and no other administrator can reset it;
 *   - the HAND-OVER of the initial SUPER_ADMIN (--retire): the application never lets anyone delete, deactivate, demote or lock out the
 *     installation's initial administrator (UserRoleService.initialAdministratorId), so when that person leaves, the owner retires the
 *     account HERE — after another administrator exists. See "--retire" below.
 *
 * What it does for ONE account, identified by e-mail, in ONE transaction:
 *   - creates the account if it does not exist (never touches a soft-deleted one — restore it or use another address);
 *   - makes it active, sets a fresh random TEMPORARY password (hashed like every other password) and requires the holder to replace it
 *     at their first sign-in — the API refuses everything else until they have, so the person who ran this tool never knows the password
 *     the administrator finally chooses;
 *   - revokes the account's live sessions;
 *   - makes sure it holds SUPER_ADMIN;
 *   - writes one audit row (the e-mail and the password are NOT in it).
 * The temporary password is printed ONCE, to this terminal, and stored nowhere in clear text. Hand it over through a secure channel.
 *
 * DRY RUN BY DEFAULT — it only reports. Nothing changes without --apply. The very first line it prints is "[typeorm-cli] <env file> ->
 * user@host/database" (from src/config/data-source.ts): the database it is about to change. READ IT before using --apply — an unset APP_ENV
 * reads ".env" — and take a backup first on a shared database. It runs through ts-node, so it needs the project's dev dependencies.
 *
 *   cd "CCB API"
 *   APP_ENV=<env>   (unset = .env; see src/config/env-file.ts)  \
 *   npm run maintenance:super-admin -- --list                                  # who holds SUPER_ADMIN, read-only
 *   npm run maintenance:super-admin -- --email it.lead@customer.example --name "Grace Hopper"           # dry run
 *   npm run maintenance:super-admin -- --email it.lead@customer.example --name "Grace Hopper" --apply   # do it
 *
 * --retire (with --email): retires ONE administrator account — the hand-over. It deactivates the account, CLEARS its password (so
 * re-activating it later cannot silently bring back working credentials) and revokes its live sessions, in one transaction that first
 * locks every active SUPER_ADMIN. It REFUSES when no OTHER administrator would remain who is active AND can sign in (has a password): an
 * installation must always keep someone who can administer it — create another administrator first. The account is not deleted and keeps
 * its roles and history. When it was the initial administrator, the protection passes to the oldest remaining active SUPER_ADMIN (note:
 * the protected account is always "the oldest ACTIVE holder", so re-activating an older retired account would make it the initial one
 * again). One audit row is written. Dry run by default, like everything here:
 *
 *   npm run maintenance:super-admin -- --retire --email grace@customer.example            # dry run
 *   npm run maintenance:super-admin -- --retire --email grace@customer.example --apply    # do it
 *
 * Refuses when the SUPER_ADMIN role does not exist at all — start the application once first (BOOTSTRAP_SEED_ADMIN=false seeds the role
 * and no account). Never deletes anyone and never removes a role from anyone.
 */
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppDataSource } from '../../src/config/data-source';
import { User } from '../../src/modules/user/entities/user.entity';
import { Role } from '../../src/modules/role/entities/role.entity';
import { UserRole } from '../../src/modules/user-role/entities/user-role.entity';
import { AuditLog } from '../../src/audit/entities/audit-log.entity';
import { AUDIT_MODULE } from '../../src/audit/audit.constants';
import { ROLES } from '../../src/common/constants/global';
import { PASSWORD_HASH_ROUNDS, PRINCIPAL_TYPE } from '../../src/common/constants/auth.constants';
import { passwordPolicyViolations } from '../../src/common/validators/strong-password.validator';
import { revokeUserSessions } from '../../src/auth/session-revocation';

const RECOVERY_AUDIT_ACTION = 'SUPER_ADMIN_RECOVERY';
const RETIRE_AUDIT_ACTION = 'SUPER_ADMIN_RETIRED';
const PASSWORD_LENGTH = 20;
// One of each class the password policy counts (it needs three), without the look-alike characters (0/O, 1/l/I) an operator would misread.
const CHARACTER_CLASSES = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%*+-=?@'];

interface Args {
  list: boolean;
  apply: boolean;
  retire: boolean;
  email: string;
  name: string;
}

/** One row of "who holds SUPER_ADMIN" (the raw query in main). `hasPassword` is 1 when the account has a password hash — without one it cannot
 *  sign in (sign-in access disabled, or never set); the application has no other way to sign a staff user in. */
interface Holder {
  id: number;
  email: string;
  active: number;
  hasPassword: number;
  mustChange: number;
  lastLogin: Date | null;
  deletedAt: Date | null;
}

/** An administrator who could actually administer: active, not deleted, and able to sign in. */
const canAdminister = (holder: Holder): boolean => Number(holder.active) === 1 && !holder.deletedAt && Number(holder.hasPassword) === 1;

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string => {
    const at = argv.indexOf(flag);
    return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1].trim() : '';
  };
  return { list: argv.includes('--list'), apply: argv.includes('--apply'), retire: argv.includes('--retire'), email: read('--email'), name: read('--name') };
}

/** A random temporary password that satisfies the password policy: at least one character of every class, the rest from all of them, shuffled. */
function generateTemporaryPassword(): string {
  const all = CHARACTER_CLASSES.join('');
  const chars = CHARACTER_CLASSES.map((set) => set[randomInt(set.length)]);
  while (chars.length < PASSWORD_LENGTH) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const password = chars.join('');
  if (passwordPolicyViolations(password).length > 0) throw new Error('internal error: the generated password does not meet the password policy');
  return password;
}

/**
 * --retire: the hand-over of an administrator account (typically the initial one). Deactivates it and ends its sessions; never deletes it,
 * never removes its roles. Refuses when no OTHER active SUPER_ADMIN would remain — checked once up front for the plan, and again inside the
 * transaction under a lock on every active holder, so two operators retiring each other at the same moment cannot leave nobody.
 */
async function retireAdministrator(args: Args, roleId: number, usable: Holder[]): Promise<void> {
  // Deleted accounts are not found here (no withDeleted): a deleted account is not an administrator.
  const account = await AppDataSource.getRepository(User).findOne({ where: { email: args.email } });
  const holder = account ? usable.find((candidate) => Number(candidate.id) === account.id) : undefined;
  if (!account || !holder) {
    console.error(`${args.email} is not an active ${ROLES.SUPER_ADMIN} in this installation — there is nothing to retire.`);
    process.exitCode = 1;
    return;
  }
  // Who would remain: other administrators that are active, and of those the ones that can actually sign in.
  const others = usable.filter((candidate) => Number(candidate.id) !== account.id);
  const successors = others.filter(canAdminister);
  if (successors.length === 0) {
    console.error(
      others.length === 0
        ? `${args.email} is the only active ${ROLES.SUPER_ADMIN}. `
        : `${args.email} is the only active ${ROLES.SUPER_ADMIN} who can sign in (the other ${others.length} active holder(s) have no password — their sign-in access was disabled or never set). `,
    );
    console.error(
      'An installation must always keep someone who can administer it: create or recover another administrator first ' +
        '(the same command with --email and --name, without --retire), then retire this one.',
    );
    process.exitCode = 1;
    return;
  }
  // `usable` is ordered by user id: the first row is the initial administrator (the application's rule: the oldest ACTIVE holder), the first of
  // the others its heir. The heir is protected by the application even if it has no password; the first of `successors` is the first who can sign in.
  const wasInitial = Number(usable[0].id) === account.id;
  const heir = others[0];
  const heirNote = canAdminister(heir) ? '' : ` — it has NO password and cannot sign in; the first remaining administrator who can is #${successors[0].id} (${successors[0].email})`;
  console.log(
    `\nPlan: deactivate account #${account.id} (${args.email}), clear its password and revoke its live sessions; it is not deleted and keeps its roles. ` +
      (wasInitial
        ? `It is the INITIAL ${ROLES.SUPER_ADMIN}: the protection passes to the oldest remaining active administrator, #${heir.id} (${heir.email})${heirNote}. `
        : `${others.length} other active ${ROLES.SUPER_ADMIN} account(s) remain. `) +
      `Re-activating it later needs a new password set by a ${ROLES.SUPER_ADMIN}.`,
  );
  if (!args.apply) {
    console.log('DRY RUN — nothing was changed. Add --apply to do it (take a backup of a shared database first).');
    return;
  }

  await AppDataSource.transaction(async (manager) => {
    // Every active holder, locked in id order: a second retirement running now waits here and then sees this one's result.
    const active: Array<{ id: number; hasPassword: number }> = await manager.query(
      `SELECT u.id AS id, (u.password_hash IS NOT NULL) AS hasPassword FROM user_roles ur JOIN users u ON u.id = ur.user_id
        WHERE ur.role_id = ? AND u.active = 1 AND u.deleted_at IS NULL ORDER BY u.id FOR UPDATE`,
      [roleId],
    );
    const stillThere = active.some((row) => Number(row.id) === account.id);
    const someoneElseCanSignIn = active.some((row) => Number(row.id) !== account.id && Number(row.hasPassword) === 1);
    if (!stillThere || !someoneElseCanSignIn) {
      throw new Error(`Refused: ${args.email} is no longer an active ${ROLES.SUPER_ADMIN}, or no other active ${ROLES.SUPER_ADMIN} who can sign in remains — nothing was changed.`);
    }
    // Deactivated, and its password cleared the way "disable sign-in access" does it (the application's own routine): re-activating a
    // retired account later cannot silently bring its old credentials back.
    await manager.getRepository(User).update({ id: account.id }, { active: false, passwordHash: null, passwordUpdatedAt: new Date() });
    await revokeUserSessions(manager, PRINCIPAL_TYPE.STAFF, account.id);

    const audit = manager.getRepository(AuditLog);
    await audit.save(
      audit.create({
        moduleName: AUDIT_MODULE.USERS,
        entityId: account.id,
        action: RETIRE_AUDIT_ACTION,
        oldValue: JSON.stringify({ active: true, role: ROLES.SUPER_ADMIN, wasInitialAdministrator: wasInitial }),
        newValue: JSON.stringify({ active: false, passwordCleared: true, sessionsRevoked: true, via: 'server maintenance tool' }),
        performedBy: null,
      }),
    );
  });

  console.log(`\nDone. Account #${account.id} (${args.email}) is deactivated, has no password and is signed out everywhere; it was not deleted.`);
  if (wasInitial) console.log(`The initial ${ROLES.SUPER_ADMIN} is now #${heir.id} (${heir.email}) — the oldest remaining active administrator${heirNote}.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();
  try {
    // The database compares role names case- and accent-insensitively, so the lookup is re-checked against the EXACT name.
    const role = (await AppDataSource.getRepository(Role).find({ where: { roleName: ROLES.SUPER_ADMIN } })).find((candidate) => candidate.roleName === ROLES.SUPER_ADMIN);
    if (!role) {
      console.error(
        `There is no "${ROLES.SUPER_ADMIN}" role in this database. On a database that has never held a user, start the application once so that it can seed it ` +
          '(BOOTSTRAP_SEED_ADMIN=false seeds the role and no account), then run this again. On a database that already has users the application never seeds again: ' +
          'the role row has to be restored first — see docs/PROPOSED_SCHEMA_CHANGES.md, section 4.',
      );
      process.exitCode = 1;
      return;
    }

    const holders: Holder[] = await AppDataSource.query(
      `SELECT u.id AS id, u.email AS email, u.active AS active, (u.password_hash IS NOT NULL) AS hasPassword, u.must_change_password AS mustChange,
              u.last_login_at AS lastLogin, u.deleted_at AS deletedAt
         FROM user_roles ur JOIN users u ON u.id = ur.user_id
        WHERE ur.role_id = ? ORDER BY u.id`,
      [role.id],
    );
    const usable = holders.filter((holder) => Number(holder.active) === 1 && !holder.deletedAt);
    console.log(`${ROLES.SUPER_ADMIN} holders in this installation: ${holders.length} (active: ${usable.length}, able to sign in: ${holders.filter(canAdminister).length})`);
    for (const holder of holders) {
      const state = holder.deletedAt ? 'DELETED' : Number(holder.active) === 1 ? 'active' : 'INACTIVE';
      console.log(
        `  #${holder.id}  ${holder.email}  ${state}${Number(holder.hasPassword) === 1 ? '' : '  (no password — cannot sign in)'}` +
          `${Number(holder.mustChange) === 1 ? '  (must set a new password)' : ''}${holder.lastLogin ? '' : '  (never signed in)'}`,
      );
    }
    if (args.list || (!args.email && !args.apply)) {
      if (!args.list) console.log('\nGive --email (and --name) to create or recover an administrator, or --retire --email to retire one; add --apply to do it.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
      console.error('--email must be the real e-mail address of the account (of the person who will administer this installation, or the one being retired).');
      process.exitCode = 1;
      return;
    }

    if (args.retire) {
      await retireAdministrator(args, role.id, usable);
      return;
    }

    const existing = await AppDataSource.getRepository(User).findOne({ where: { email: args.email }, withDeleted: true });
    if (existing?.deletedAt) {
      console.error('An account with this e-mail exists but is deleted, so it is not touched. Restore it first, or use another address.');
      process.exitCode = 1;
      return;
    }
    const alreadyHolds = existing ? !!(await AppDataSource.getRepository(UserRole).findOne({ where: { userId: existing.id, roleId: role.id } })) : false;

    console.log(
      `\nPlan: ${existing ? `recover the existing account #${existing.id}` : 'create a new account'} for ${args.email}; ` +
        `${existing ? 'activate it, ' : ''}set a temporary password that must be replaced at the first sign-in; ` +
        `${existing ? 'revoke its live sessions; ' : ''}${alreadyHolds ? 'it already holds' : 'grant'} ${ROLES.SUPER_ADMIN}.`,
    );
    if (!args.apply) {
      console.log('DRY RUN — nothing was changed. Add --apply to do it (take a backup of a shared database first).');
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, PASSWORD_HASH_ROUNDS);
    const accountId = await AppDataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      let userId: number;
      if (existing) {
        userId = existing.id;
        await users.update({ id: userId }, { active: true, passwordHash, mustChangePassword: true, passwordUpdatedAt: new Date() });
        // The application's own "end sessions" routine: tokens revoked, devices closed, login history closed — never half-ended.
        await revokeUserSessions(manager, PRINCIPAL_TYPE.STAFF, userId);
      } else {
        const spaceAt = args.name.indexOf(' ');
        const firstName = (args.name === '' ? 'System' : spaceAt === -1 ? args.name : args.name.slice(0, spaceAt)).trim();
        const lastName = (args.name === '' || spaceAt === -1 ? 'Administrator' : args.name.slice(spaceAt + 1)).trim();
        const created = await users.save(users.create({ firstName, lastName, email: args.email, active: true, passwordHash, mustChangePassword: true, passwordUpdatedAt: new Date() }));
        userId = created.id;
      }

      const userRoles = manager.getRepository(UserRole);
      if (!(await userRoles.findOne({ where: { userId, roleId: role.id } }))) await userRoles.save(userRoles.create({ userId, roleId: role.id }));

      const audit = manager.getRepository(AuditLog);
      await audit.save(
        audit.create({
          moduleName: AUDIT_MODULE.USERS,
          entityId: userId,
          action: RECOVERY_AUDIT_ACTION,
          oldValue: JSON.stringify({ existed: !!existing, wasActive: existing ? existing.active : null }),
          newValue: JSON.stringify({ role: ROLES.SUPER_ADMIN, mustChangePassword: true, sessionsRevoked: !!existing, via: 'server maintenance tool' }),
          performedBy: null,
        }),
      );
      return userId;
    });

    console.log(`\nDone. Account #${accountId} (${args.email}) is an active ${ROLES.SUPER_ADMIN}.`);
    console.log('TEMPORARY PASSWORD (shown once, stored nowhere in clear text — hand it over through a secure channel):');
    console.log(`  ${temporaryPassword}`);
    console.log('The holder must set their own password at the first sign-in; nothing else works until they have.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
