import { describe, it, expect } from "vitest";
import { readEntryFromUrl } from "./entry";

describe("readEntryFromUrl", () => {
  it("reads a grant", () => {
    expect(readEntryFromUrl("?grant=abc")).toEqual({ kind: "grant", token: "abc" });
  });

  it("reads an invitation", () => {
    expect(readEntryFromUrl("?invite=xyz")).toEqual({ kind: "invite", token: "xyz" });
  });

  it("reads a password reset", () => {
    expect(readEntryFromUrl("?reset=r1")).toEqual({ kind: "reset", token: "r1" });
  });

  it("prefers the grant when more than one is present", () => {
    expect(readEntryFromUrl("?invite=xyz&grant=abc")).toEqual({ kind: "grant", token: "abc" });
  });

  it("returns null when there is nothing to consume", () => {
    expect(readEntryFromUrl("?period=7d")).toBeNull();
    expect(readEntryFromUrl("?grant=")).toBeNull();
  });
});
