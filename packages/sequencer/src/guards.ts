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
  /**
   * IANA timezone (e.g. "Europe/Amsterdam") in which `startHour`,
   * `endHour` and `weekdays` are interpreted. When omitted, falls back
   * to the host's local time — fine for unit tests, but in production
   * Docker containers that's UTC, which would shift a "9-16 lokale tijd"
   * window two hours later than the agency expects in summer. Set this
   * to the agency's tz so the dashboard hour numbers mean what users
   * think they mean.
   */
  timezone?: string;
}

export const DEFAULT_SEND_WINDOW: SendWindow = {
  startHour: 9,
  endHour: 16,
  weekdays: [2, 3, 4], // tue, wed, thu — per plan
};

export function isInSendWindow(now: Date, window: SendWindow): boolean {
  const { hour, isoWeekday: wd } = window.timezone
    ? zonedHourAndWeekday(now, window.timezone)
    : { hour: now.getHours(), isoWeekday: localIsoWeekday(now) };
  if (!window.weekdays.includes(wd)) return false;
  return hour >= window.startHour && hour < window.endHour;
}

/**
 * Start of "today" in the given timezone, as a UTC Date. When the tz is
 * omitted we fall back to host-local midnight — same caveat as
 * isInSendWindow: in UTC Docker that's UTC midnight, which is +2h vs.
 * the agency's wall clock during CEST.
 */
export function startOfDay(now: Date, timezone?: string): Date {
  if (!timezone) {
    const out = new Date(now);
    out.setHours(0, 0, 0, 0);
    return out;
  }
  const parts = zonedDateParts(now, timezone);
  const elapsedMs =
    ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000 +
    now.getMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

interface ZonedParts {
  hour: number;
  minute: number;
  second: number;
  isoWeekday: number;
}

function zonedDateParts(d: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekdayStr = get("weekday");
  const hour = Number(get("hour"));
  return {
    hour: hour === 24 ? 0 : hour, // some runtimes still emit 24 for midnight
    minute: Number(get("minute")),
    second: Number(get("second")),
    isoWeekday: WEEKDAY_TO_ISO[weekdayStr] ?? 0,
  };
}

function zonedHourAndWeekday(
  d: Date,
  timezone: string,
): { hour: number; isoWeekday: number } {
  const { hour, isoWeekday } = zonedDateParts(d, timezone);
  return { hour, isoWeekday };
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

function localIsoWeekday(d: Date): number {
  // JS getDay(): 0=Sun..6=Sat. ISO: 1=Mon..7=Sun.
  const js = d.getDay();
  return js === 0 ? 7 : js;
}
