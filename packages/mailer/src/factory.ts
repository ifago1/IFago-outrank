import type { Mailer } from "./types.js";
import { PostmarkMailer, type PostmarkMailerOptions } from "./postmark.js";
import { SmtpMailer, type SmtpMailerOptions } from "./smtp.js";

export type MailerProvider = "postmark" | "smtp";

export interface CreateMailerInput {
  provider: MailerProvider;
  postmark?: PostmarkMailerOptions;
  smtp?: SmtpMailerOptions;
}

/**
 * Provider-agnostic factory. Validates that the requested provider has
 * its config block populated, then constructs the right mailer.
 */
export function createMailer(input: CreateMailerInput): Mailer {
  if (input.provider === "smtp") {
    if (!input.smtp) {
      throw new Error("createMailer: provider=smtp requires `smtp` options");
    }
    return new SmtpMailer(input.smtp);
  }
  if (input.provider === "postmark") {
    if (!input.postmark) {
      throw new Error(
        "createMailer: provider=postmark requires `postmark` options",
      );
    }
    return new PostmarkMailer(input.postmark);
  }
  // Exhaustive check — TypeScript will flag if we add a provider above.
  const _exhaustive: never = input.provider;
  throw new Error(`Unknown mailer provider: ${_exhaustive as string}`);
}
