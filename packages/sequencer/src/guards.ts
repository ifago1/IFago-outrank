/**
 * Pure pre-send guards. They are pure (no I/O) so they're trivially testable
 * and so callers can compose them with their own data sources. The five
 * checks come straight from sectie 6 / module 5 of the project plan.
 */

export interface SendWindow {
  /** Hour of day, inclusive (0-23). */
  startHour: number;
  /** Hour of day, exclusive (1-24). */
  endHour: number;
  /** ISO weekday numbers allowed: 1=Mon ... 7=Sun. */
  weekdays: number[];
}

export const DEFAULT_SEND_WINDOW: SendWindow = {
  startHour: 9,
  endHour: 16,
  weekdays: [2, 3, 4], // tue, wed, thu — per plan
};

export function isInSendWindow(now: Date, window: SendWindow): boolean {
  const wd = isoWeekday(now);
  if (!window.weekdays.includes(wd)) return false;
  const h = now.getHours();
  return h >= window.startHour && h < window.endHour;
}

export function isUnsubscribed(
  email: string,
  unsubscribed: Iterable<string>,
): boolean {
  const norm = email.trim().toLowerCase();
  for (const u of unsubscribed) {
    if (u.trim().toLowerCase() === norm) return true;
  }
  return false;
}

export function isDailyLimitReached(
  sentToday: number,
  limit: number,
): boolean {
  return sentToday >= limit;
}

export type SkipReason =
  | "unsubscribed"
  | "do_not_contact"
  | "already_in_other_campaign"
  | "outside_send_window"
  | "daily_limit_reached";

export interface PreSendCheckInput {
  email: string;
  contactDoNotContact: boolean;
  /** Set of business IDs that already have a *different* active campaign-lead. */
  hasOtherActiveCampaign: boolean;
  unsubscribed: Iterable<string>;
  now: Date;
  window: SendWindow;
  sentToday: number;
  dailyLimit: number;
  /**
   * Allow leads in already-running campaigns to coexist if the agency wants
   * that. Default false — we follow the plan's stricter posture.
   */
  allowMultipleCampaignsPerBusiness?: boolean;
}

/**
 * Returns null if the lead may be sent, or the first failed reason if not.
 * Order matches the project plan exactly.
 */
export function preSendCheck(input: PreSendCheckInput): SkipReason | null {
  if (isUnsubscribed(input.email, input.unsubscribed)) return "unsubscribed";
  if (input.contactDoNotContact) return "do_not_contact";
  if (
    !input.allowMultipleCampaignsPerBusiness &&
    input.hasOtherActiveCampaign
  ) {
    return "already_in_other_campaign";
  }
  if (!isInSendWindow(input.now, input.window)) return "outside_send_window";
  if (isDailyLimitReached(input.sentToday, input.dailyLimit))
    return "daily_limit_reached";
  return null;
}

function isoWeekday(d: Date): number {
  // JS getDay(): 0=Sun..6=Sat. ISO: 1=Mon..7=Sun.
  const js = d.getDay();
  return js === 0 ? 7 : js;
}
