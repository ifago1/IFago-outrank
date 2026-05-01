import { describe, expect, it } from "vitest";
import { TICK_QUEUE } from "./queues.js";

describe("queue constants", () => {
  it("uses a stable queue name shared between worker and scheduler", () => {
    expect(TICK_QUEUE).toBe("outreach:tick");
  });
});
