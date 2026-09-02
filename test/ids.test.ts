import { describe, expect, it } from "vitest";
import { createId } from "../src/lib/ids";

describe("createId", () => {
  it("creates prefixed, distinct identifiers", () => {
    const first = createId("jnl");
    const second = createId("jnl");
    expect(first).toMatch(/^jnl_[a-z0-9]{16}$/);
    expect(second).not.toBe(first);
  });
});
