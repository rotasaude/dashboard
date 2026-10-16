import { describe, expect, it } from "vitest";
import { canSign, documentLabel } from "./signature";
import { labUser } from "../test/labFixtures";

describe("assinatura ICP do laudo laboratorial (módulo 21b)", () => {
  it("o liberador assina com digital_signature ligado; sem ele, não", () => {
    expect(canSign(labUser([ "lab_releaser" ], { features: [ "exam_tracking", "municipal_lab", "digital_signature" ] }))).toBe(true);
    expect(canSign(labUser([ "lab_releaser" ]))).toBe(false);
    expect(canSign(labUser([ "lab_staff" ], { features: [ "digital_signature" ] }))).toBe(false);
  });

  it("rótulo do documento", () => {
    expect(documentLabel("lab_report")).toBe("laudo laboratorial");
  });
});
