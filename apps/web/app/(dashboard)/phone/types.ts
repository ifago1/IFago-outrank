export const PHONE_STATUSES = [
  "called",
  "voicemail",
  "callback",
  "interested",
  "not_interested",
  "wrong_number",
] as const;

export type PhoneStatus = (typeof PHONE_STATUSES)[number];

export interface PhoneStatusActionResult {
  ok: boolean;
  message: string;
}

export interface PhoneLeadRow {
  businessId: string;
  name: string;
  city: string | null;
  category: string | null;
  phone: string | null;
  websiteUrl: string | null;
  websiteQuality: string | null;
  rating: number | null;
  reviewsCount: number | null;
  phoneStatus: PhoneStatus | null;
  phoneCalledAt: string | null;
  phoneNotes: string | null;
  phoneNextAttemptAt: string | null;
  phoneAttempts: number;
  heat: number;
}

export const STATUS_META: Record<
  PhoneStatus,
  { label: string; tone: "ok" | "warn" | "bad" | "neutral" }
> = {
  called: { label: "gebeld", tone: "neutral" },
  voicemail: { label: "voicemail", tone: "warn" },
  callback: { label: "callback gevraagd", tone: "warn" },
  interested: { label: "interesse", tone: "ok" },
  not_interested: { label: "geen interesse", tone: "bad" },
  wrong_number: { label: "verkeerd nummer", tone: "bad" },
};
