"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { businesses, contacts, getDb } from "@outreach/db";
import {
  PHONE_STATUSES,
  STATUS_META,
  type PhoneStatus,
  type PhoneStatusActionResult,
} from "./types";

const VALID = new Set<string>(PHONE_STATUSES);

/**
 * Zet de phone-status voor één business + optionele notities. Side
 * effects per status:
 *   - not_interested / wrong_number → alle contacts op DNC (ze gaan
 *     niet meer via mail-campagne ook)
 *   - wrong_number → wist ook businesses.phone zodat 'ie niet meer
 *     opduikt
 *   - interested / voicemail / callback → leave-as-is, lead blijft
 *     zichtbaar in de Bellen-tab follow-up sectie
 */
export async function setPhoneStatus(
  businessId: string,
  form: FormData,
): Promise<PhoneStatusActionResult> {
  if (!businessId) return { ok: false, message: "Geen business-id." };

  const rawStatus = String(form.get("status") ?? "").trim();
  const clearMode = rawStatus === "" || rawStatus === "clear";
  const notes = String(form.get("notes") ?? "").trim() || null;

  if (!clearMode && !VALID.has(rawStatus)) {
    return { ok: false, message: `Onbekende status "${rawStatus}".` };
  }
  const status = clearMode ? null : (rawStatus as PhoneStatus);

  const db = getDb();
  const now = new Date();

  const updates: {
    phoneStatus: PhoneStatus | null;
    phoneCalledAt: Date | null;
    phoneNotes: string | null;
    phone?: null;
  } = {
    phoneStatus: status,
    phoneCalledAt: status ? now : null,
    phoneNotes: notes,
  };

  // wrong_number: wis het telefoonnummer zodat 'ie niet meer opduikt
  if (status === "wrong_number") {
    updates.phone = null;
  }

  await db
    .update(businesses)
    .set(updates)
    .where(eq(businesses.id, businessId));

  // not_interested / wrong_number → DNC op alle contacts van deze
  // business. Voorkomt dat 'ie via een mail-campagne alsnog benaderd
  // wordt na een telefonische "nee".
  if (status === "not_interested" || status === "wrong_number") {
    await db
      .update(contacts)
      .set({ doNotContact: true })
      .where(eq(contacts.businessId, businessId));
  }

  revalidatePath("/phone");
  revalidatePath(`/leads/${businessId}`);
  revalidatePath("/leads");

  const meta = status ? STATUS_META[status] : null;
  const labelPart = meta ? `op "${meta.label}"` : "gewist";
  const sidePart =
    status === "not_interested" || status === "wrong_number"
      ? " · contacts op DNC"
      : "";
  return {
    ok: true,
    message: `Status ${labelPart}${sidePart}.`,
  };
}
