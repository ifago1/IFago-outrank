/**
 * The default 3-step cold-mail sequence from sectie 10 of the project plan.
 *
 * Variables:
 *   {{first_name}}, {{business_name}}, {{personal_observation}},
 *   {{sender_name}}, {{unsubscribe_url}}
 */

export interface SequenceStepDef {
  stepOrder: number;
  delayDays: number;
  subjectTemplate: string;
  bodyTemplate: string;
}

export const DEFAULT_SEQUENCE: SequenceStepDef[] = [
  {
    stepOrder: 1,
    delayDays: 0,
    subjectTemplate: "Snelle vraag over {{business_name}}",
    bodyTemplate: `Hi {{first_name}},

Ik kwam {{business_name}} tegen op Google – {{personal_observation}}. Wat me opviel: er staat geen website gekoppeld aan jullie profiel. Klopt dat, of zoeken klanten jullie via een andere weg?

Ik help bedrijven zoals jullie aan een simpele, snelle site die nieuwe klanten via Google binnenbrengt. Open voor 10 minuten bellen om te kijken of het bij jullie past?

Groet,
{{sender_name}}

—
Liever geen mails? {{unsubscribe_url}}`,
  },
  {
    stepOrder: 2,
    delayDays: 4,
    subjectTemplate: "Re: Snelle vraag over {{business_name}}",
    bodyTemplate: `Hi {{first_name}},

Korte reminder op onderstaande – wellicht gemist. Heeft het zin om kort te sparren, of is het op dit moment niet relevant? Beide is prima.

Groet,
{{sender_name}}

—
Liever geen mails? {{unsubscribe_url}}`,
  },
  {
    stepOrder: 3,
    delayDays: 5,
    subjectTemplate: "Laatste berichtje",
    bodyTemplate: `Hi {{first_name}},

Ik laat het hierbij – wil je niet blijven mailen. Mocht je later toch nieuwsgierig zijn naar wat een goede website kan opleveren voor {{business_name}}, mijn deur staat open.

Succes met de zaak!
{{sender_name}}

—
Liever geen mails? {{unsubscribe_url}}`,
  },
];
