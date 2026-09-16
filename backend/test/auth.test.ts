import { describe, expect, it } from "vitest";
import { credentialsMatch, signSession, verifySession } from "../src/auth/session.js";

describe("dashboard login", () => {
  it("accepts the BluWheelz operator credentials", () => {
    expect(credentialsMatch("bluewheelz", "bluewheelz")).toBe(true);
    expect(credentialsMatch(" bluewheelz ", "bluewheelz")).toBe(true);
  });

  it("rejects wrong username or password", () => {
    expect(credentialsMatch("bluewheelz", "wrong")).toBe(false);
    expect(credentialsMatch("other", "bluewheelz")).toBe(false);
  });

  it("round-trips a signed session token", () => {
    const token = signSession("bluewheelz");
    expect(verifySession(token)?.username).toBe("bluewheelz");
    expect(verifySession(`${token}x`)).toBeNull();
    expect(verifySession("not-a-token")).toBeNull();
  });
});
