import { ImapFlow } from "imapflow";
import type { ImapConnectionConfig } from "./types.js";

export interface FetchedRawMessage {
  uid: number;
  raw: Buffer;
}

/**
 * Thin wrapper around imapflow tailored to our poll loop:
 *   - open() once per poll
 *   - listUnseen() returns up to `limit` UIDs of UNSEEN mail
 *   - fetchRaw() pulls full RFC822 source for one UID
 *   - markSeen() flips \Seen so the next poll skips it
 *   - close() drains the connection
 *
 * We deliberately don't keep a long-lived IDLE connection — polling is
 * cheaper to operate (no auto-reconnect logic, no thundering-herd on
 * worker restart) and 10-minute latency is fine for B2B outreach.
 */
export class ImapClient {
  private readonly config: Required<Omit<ImapConnectionConfig, "folder">> & {
    folder: string;
  };
  private client: ImapFlow | null = null;
  private lock: { release(): void } | null = null;

  constructor(config: ImapConnectionConfig) {
    this.config = {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      pass: config.pass,
      timeoutMs: config.timeoutMs ?? 20_000,
      folder: config.folder ?? "INBOX",
    };
  }

  async open(): Promise<void> {
    if (this.client) return;
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.user, pass: this.config.pass },
      logger: false,
      socketTimeout: this.config.timeoutMs,
    });
    await client.connect();
    this.lock = await client.getMailboxLock(this.config.folder);
    this.client = client;
  }

  async listUnseen(limit: number): Promise<number[]> {
    const c = this.requireClient();
    const uids = (await c.search({ seen: false }, { uid: true })) || [];
    return uids.slice(0, limit);
  }

  async fetchRaw(uid: number): Promise<FetchedRawMessage | null> {
    const c = this.requireClient();
    const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
    if (!msg || !msg.source) return null;
    return { uid, raw: msg.source };
  }

  async markSeen(uid: number): Promise<void> {
    const c = this.requireClient();
    await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
  }

  async close(): Promise<void> {
    try {
      this.lock?.release();
    } catch {
      /* lock already released — fine. */
    }
    this.lock = null;
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        /* server already disconnected — fine. */
      }
      this.client = null;
    }
  }

  private requireClient(): ImapFlow {
    if (!this.client) throw new Error("ImapClient: open() not called");
    return this.client;
  }
}
