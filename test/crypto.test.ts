import { describe, expect, it } from "vitest";
import { encryptSensitive } from "../src/lib/crypto";

describe("sensitive financial data encryption", () => {
  it("does not retain plaintext and uses a fresh IV", async () => {
    const plaintext = "001234567890";
    const first = await encryptSensitive(plaintext, "a-development-secret-with-enough-entropy");
    const second = await encryptSensitive(plaintext, "a-development-secret-with-enough-entropy");
    expect(first).not.toContain(plaintext);
    expect(first).not.toEqual(second);
    expect(first.split(".")).toHaveLength(2);
  });
});
