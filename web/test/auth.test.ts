import { describe, expect, it } from "vitest";
import { resolveSession } from "../src/worker/auth.js";

const SECRET = "test-secret";

function cookieFrom(setCookie: string): string {
  return setCookie.split(";")[0]; // "gpsid=<token>"
}

describe("session signing", () => {
  it("mints a signed session when no cookie is present", async () => {
    const session = await resolveSession(new Request("https://x/"), SECRET);
    expect(session.userId).toBeTruthy();
    expect(session.setCookie).toContain("gpsid=");
    expect(session.setCookie).toContain("HttpOnly");
  });

  it("accepts its own signed cookie without re-minting", async () => {
    const first = await resolveSession(new Request("https://x/"), SECRET);
    const req = new Request("https://x/", { headers: { Cookie: cookieFrom(first.setCookie!) } });
    const second = await resolveSession(req, SECRET);
    expect(second.userId).toBe(first.userId);
    expect(second.setCookie).toBeUndefined();
  });

  it("rejects a tampered cookie and mints a fresh session", async () => {
    const first = await resolveSession(new Request("https://x/"), SECRET);
    const tampered = cookieFrom(first.setCookie!).replace("gpsid=", "gpsid=evil-");
    const req = new Request("https://x/", { headers: { Cookie: tampered } });
    const second = await resolveSession(req, SECRET);
    expect(second.userId).not.toBe(first.userId);
    expect(second.setCookie).toBeDefined();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const first = await resolveSession(new Request("https://x/"), "other-secret");
    const req = new Request("https://x/", { headers: { Cookie: cookieFrom(first.setCookie!) } });
    const second = await resolveSession(req, SECRET);
    expect(second.userId).not.toBe(first.userId);
  });
});
