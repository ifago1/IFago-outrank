"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, getSetting, savedSearches } from "@outreach/db";
import { runSavedSearch } from "@outreach/discovery";
import type { DiscoverActionResult } from "./types";

interface SearchInput {
  name: string;
  niche: string;
  city: string;
  radiusMeters: number | null;
  maxPages: number;
  scheduleEnabled: boolean;
  scheduleIntervalDays: number;
}

function parseFormFields(form: FormData): SearchInput {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const radiusRaw = get("radiusMeters");
  return {
    name: get("name"),
    niche: get("niche"),
    city: get("city"),
    radiusMeters: radiusRaw ? Number(radiusRaw) : null,
    maxPages: Math.min(3, Math.max(1, Number(get("maxPages")) || 1)),
    scheduleEnabled: form.get("scheduleEnabled") === "on",
    scheduleIntervalDays: Math.max(1, Number(get("scheduleIntervalDays")) || 7),
  };
}

function validate(input: SearchInput): string | null {
  if (!input.name) return "Naam is vereist";
  if (!input.niche) return "Niche is vereist";
  if (!input.city) return "Stad is vereist";
  if (input.radiusMeters !== null && (input.radiusMeters < 0 || input.radiusMeters > 50_000)) {
    return "Radius moet tussen 0 en 50.000 meter zijn";
  }
  return null;
}

export async function createSearch(form: FormData): Promise<DiscoverActionResult> {
  const input = parseFormFields(form);
  const err = validate(input);
  if (err) return { ok: false, message: err };

  const db = getDb();
  await db.insert(savedSearches).values({
    name: input.name,
    niche: input.niche,
    city: input.city,
    radiusMeters: input.radiusMeters,
    maxPages: input.maxPages,
    scheduleEnabled: input.scheduleEnabled,
    scheduleIntervalDays: input.scheduleIntervalDays,
  });

  revalidatePath("/discover");
  return { ok: true, message: `Saved search "${input.name}" aangemaakt.` };
}

export async function updateSearch(
  id: string,
  form: FormData,
): Promise<DiscoverActionResult> {
  const input = parseFormFields(form);
  const err = validate(input);
  if (err) return { ok: false, message: err };

  const db = getDb();
  await db
    .update(savedSearches)
    .set({
      name: input.name,
      niche: input.niche,
      city: input.city,
      radiusMeters: input.radiusMeters,
      maxPages: input.maxPages,
      scheduleEnabled: input.scheduleEnabled,
      scheduleIntervalDays: input.scheduleIntervalDays,
    })
    .where(eq(savedSearches.id, id));

  revalidatePath("/discover");
  return { ok: true, message: "Opgeslagen." };
}

export async function deleteSearch(id: string): Promise<DiscoverActionResult> {
  const db = getDb();
  await db.delete(savedSearches).where(eq(savedSearches.id, id));
  revalidatePath("/discover");
  return { ok: true, message: "Verwijderd." };
}

/**
 * Fire-and-forget the discovery for one saved search. We run it
 * in-process so the user gets the result immediately. For 60+ results
 * the API + DB upsert takes ~5-15 seconds — within the Next server
 * action timeout.
 */
export async function runSearchNow(id: string): Promise<DiscoverActionResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, message: "Search niet gevonden." };

  const dbKey = await getSetting(db, "GOOGLE_PLACES_API_KEY");
  const apiKey = dbKey ?? process.env["GOOGLE_PLACES_API_KEY"];
  if (!apiKey) {
    return {
      ok: false,
      message:
        "GOOGLE_PLACES_API_KEY ontbreekt — vul in via Settings tab of .env.",
    };
  }

  const result = await runSavedSearch(db, apiKey, row);
  revalidatePath("/discover");
  revalidatePath("/leads");

  if (!result.ok) {
    return { ok: false, message: result.error ?? "Onbekende fout" };
  }
  return {
    ok: true,
    message: `Klaar — ${result.result?.found ?? 0} gevonden, ${result.result?.upserted ?? 0} opgeslagen.`,
    ...(result.result?.found !== undefined ? { found: result.result.found } : {}),
    ...(result.result?.upserted !== undefined
      ? { upserted: result.result.upserted }
      : {}),
  };
}
