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
    // ImapFlow emits 'error' on the EventEmitter for socket-level
    // failures (TCP RST, idle timeout, TLS drop). Without a listener,
    // Node treats it as unhandled and crashes the entire worker
    // process — taking down all five BullMQ workers and aborting the
    // mail-send tick mid-flight. We just log and swallow; the next
    // poll opens a fresh client.
    client.on("error", (err: Error) => {
      console.warn(
        `[inbox] imapflow socket error (suppressed): ${err.message}`,
      );
    });
    await client.connect();
    this.lock = await client.getMailboxLock(this.config.folder);
    this.client = client;
  }

  /** Custom IMAP keyword that marks "outreach-tool already handled this". */
  static readonly PROCESSED_KEYWORD = "outreachprocessed";

  /**
   * Returns up to `limit` UIDs that are still UNSEEN AND don't have the
   * `outreachprocessed` keyword. The keyword lets us skip messages we
   * already classified — without marking them \Seen — so replies stay
   * bold in the user's mail client until they read them themselves.
   */
  async listUnseen(limit: number): Promise<number[]> {
    const c = this.requireClient();
    const uids =
      (await c.search(
        { seen: false, unKeyword: ImapClient.PROCESSED_KEYWORD },
        { uid: true },
      )) || [];
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

  /**
   * Tag the message with a custom keyword so the next poll skips it
   * even though it's still UNSEEN. Survives across IMAP sessions and
   * mail-client interactions.
   */
  async markProcessed(uid: number): Promise<void> {
    const c = this.requireClient();
    await c.messageFlagsAdd(String(uid), [ImapClient.PROCESSED_KEYWORD], {
      uid: true,
    });
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
