import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { RecipientRegional } from '../../common/utils/format-for-recipient.util';
import { UserPreference } from './entities/user-preference.entity';
import {
  ChannelPreference,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationCategory,
  NotificationPreferences,
  SystemDefaults,
} from './settings.constants';
import { SettingsService } from './settings.service';

/** A way a staff notification can reach a user — the keys of what a user's preference stores per category. */
export type NotificationChannel = keyof ChannelPreference;

/** The system-wide switch (SystemDefaults.notifications) that governs each channel. */
const SYSTEM_SWITCH: Record<NotificationChannel, keyof SystemDefaults['notifications']> = {
  email: 'emailEnabled',
  inApp: 'inAppEnabled',
};

/**
 * Answers one question for every STAFF notification: "may this notice be sent to this user, on this channel, for this
 * category?". Two layers decide, and both must say yes:
 *   1. the system switch for the channel (Settings > System Settings > Notification Configuration — SUPER_ADMIN), read through
 *      SettingsService.getSystemDefaults, the same reading the Settings screens show, so there is one rule and one reader;
 *   2. the recipient's own choice for that category and channel (Settings > Notifications, user_preferences.
 *      notification_preferences). With no row, no stored category or no stored flag the default applies
 *      (DEFAULT_NOTIFICATION_PREFERENCES — on); only an explicit stored boolean overrides it.
 * Read-only: it never writes a preference or a setting. A producer asks first and simply does not send what is refused (the
 * refusal is not an error and nothing is queued for later).
 *
 * NOT covered, on purpose: transactional mail to customers and accounts — activation links, one-time codes, password resets,
 * security-deposit links and receipts (CustomerService sends them through MailService.sendTemplate). They are not
 * notifications in this sense and must NEVER be blocked by any preference or switch: an administrator turning email
 * notifications off must not stop a customer from activating their account. Only staff notifications are asked about here, and
 * MailService itself stays policy-free for the same reason.
 *
 * Today the one staff notification that exists is the workflow SLA notice to approvers (category "approvals", channel "email" —
 * WorkflowSlaSchedulerService). There is no in-app notification feature yet, so no producer asks about "inApp"; the check is
 * written for both channels so the first one that does gets the same rules.
 */
@Injectable()
export class NotificationPolicyService {
  constructor(
    @InjectRepository(UserPreference)
    private readonly prefs: Repository<UserPreference>,
    private readonly settings: SettingsService,
  ) {}

  /** The subset of `userIds` that may be sent a `category` notice on `channel`: none when the channel's system switch is off,
   *  otherwise everyone who has not switched that category and channel off for themselves. One query on user_preferences. */
  async allowedRecipients(category: NotificationCategory, channel: NotificationChannel, userIds: number[]): Promise<number[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];

    const { notifications } = await this.settings.getSystemDefaults();
    if (!notifications[SYSTEM_SWITCH[channel]]) return [];

    const rows = await this.prefs.find({ where: { userId: In(ids) }, select: { userId: true, notificationPreferences: true } });
    const stored = new Map(rows.map((row) => [row.userId, row.notificationPreferences]));
    return ids.filter((id) => this.wants(stored.get(id), category, channel));
  }

  /** The time zone and date format each user reads dates in — their own choice, else the system default — for rendering the
   *  content of a mail with formatDateTimeForRecipient. Every id gets an entry. */
  async resolveRegional(userIds: number[]): Promise<Map<number, RecipientRegional>> {
    const ids = [...new Set(userIds)];
    const regional = new Map<number, RecipientRegional>();
    if (ids.length === 0) return regional;

    const [systemDefaults, rows] = await Promise.all([
      this.settings.getSystemDefaults(),
      this.prefs.find({ where: { userId: In(ids) }, select: { userId: true, timezone: true, dateFormat: true } }),
    ]);
    const stored = new Map(rows.map((row) => [row.userId, row]));
    for (const id of ids) {
      const own = stored.get(id);
      regional.set(id, {
        timeZone: own?.timezone ?? systemDefaults.timezone,
        dateFormat: own?.dateFormat ?? systemDefaults.dateFormat,
      });
    }
    return regional;
  }

  /** The user's own choice, or the default when they have made none. The stored JSON only holds categories the user changed,
   *  and a category may be null or lack a channel — anything that is not an explicit boolean falls back to the default. */
  private wants(
    stored: Partial<NotificationPreferences> | null | undefined,
    category: NotificationCategory,
    channel: NotificationChannel,
  ): boolean {
    const choice = stored?.[category]?.[channel];
    return typeof choice === 'boolean' ? choice : DEFAULT_NOTIFICATION_PREFERENCES[category][channel];
  }
}
