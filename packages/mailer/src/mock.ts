import type { Mailer, SendEmailInput, SendEmailResult } from "./types.js";

/**
 * Captures sends in memory. Use in tests and for `--dry-run` modes.
 */
export class MockMailer implements Mailer {
  readonly sent: SendEmailInput[] = [];
  private counter = 0;

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    this.counter += 1;
    return { messageId: `mock-${this.counter}@local`, raw: { mock: true } };
  }

  reset(): void {
    this.sent.length = 0;
    this.counter = 0;
  }
}
