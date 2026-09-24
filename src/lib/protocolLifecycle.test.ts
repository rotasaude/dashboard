import { describe, expect, it } from "vitest";
import { actionsFor, awaitingMySignature, purposeForStatus, shortfallMessage, type LifecycleTarget, type Viewer } from "./protocolLifecycle";

const ME = "u-me";

function target(overrides: Partial<LifecycleTarget> = {}): LifecycleTarget {
  return {
    version: "1", status: "in_review",
    signatures: { publication: { signers: [], missing: 2 }, activation: { signers: [], missing: 2 } },
    eligibleReviewers: 3, editors: [], revertible: false, revertTargetVersion: null, ...overrides
  };
}
const viewer = (...roles: string[]): Viewer => ({ id: ME, roles });
const kinds = (t: LifecycleTarget, v: Viewer) => actionsFor(t, v).map((a) => a.kind);
const action = (t: LifecycleTarget, v: Viewer, kind: string) => actionsFor(t, v).find((a) => a.kind === kind)!;

describe("actionsFor", () => {
  it("oferece por status e por papel", () => {
    expect(kinds(target({ status: "draft" }), viewer("protocol_author"))).toEqual([ "submit" ]);
    expect(kinds(target({ status: "draft" }), viewer("protocol_publisher"))).toEqual([ "retire" ]);
    expect(kinds(target({ status: "in_review" }), viewer("protocol_reviewer"))).toEqual([ "sign" ]);
    expect(kinds(target({ status: "in_review" }), viewer("protocol_publisher"))).toEqual([ "publish", "retire" ]);
    expect(kinds(target({ status: "published" }), viewer("protocol_reviewer"))).toEqual([ "sign" ]);
    expect(kinds(target({ status: "published" }), viewer("municipal_admin"))).toEqual([ "activate" ]);
    expect(kinds(target({ status: "published" }), viewer("protocol_publisher"))).toEqual([ "activate", "retire" ]);
    expect(kinds(target({ status: "retired" }), viewer("protocol_publisher"))).toEqual([]);
  });

  it("quem não tem papel nenhum não vê ação", () => {
    expect(kinds(target({ status: "in_review" }), viewer("viewer"))).toEqual([]);
  });

  it("reverter só na versão ativa e reversível, para publisher ou admin", () => {
    expect(kinds(target({ status: "active", revertible: true }), viewer("protocol_publisher"))).toEqual([ "revert" ]);
    expect(kinds(target({ status: "active", revertible: true }), viewer("municipal_admin"))).toEqual([ "revert" ]);
    expect(kinds(target({ status: "active", revertible: false }), viewer("protocol_publisher"))).toEqual([]);
    expect(kinds(target({ status: "active", revertible: true }), viewer("protocol_reviewer"))).toEqual([]);
  });

  it("step-up em tudo menos enviar para revisão; motivo só na reversão", () => {
    expect(action(target({ status: "draft" }), viewer("protocol_author"), "submit")).toMatchObject({ stepUp: false, needsReason: false });
    expect(action(target({ status: "in_review" }), viewer("protocol_reviewer"), "sign")).toMatchObject({ stepUp: true, needsReason: false });
    expect(action(target({ status: "active", revertible: true }), viewer("protocol_publisher"), "revert"))
      .toMatchObject({ stepUp: true, needsReason: true });
  });

  it("assinar leva a finalidade do status", () => {
    expect(action(target({ status: "in_review" }), viewer("protocol_reviewer"), "sign").purpose).toBe("publication");
    expect(action(target({ status: "published" }), viewer("protocol_reviewer"), "sign").purpose).toBe("activation");
    expect(purposeForStatus("draft")).toBeNull();
  });

  it("quem editou a versão não assina", () => {
    const t = target({ status: "in_review", editors: [ { kind: "user", id: ME, email: "eu@cidade.gov.br" } ] });

    expect(action(t, viewer("protocol_reviewer"), "sign").disabledReason).toBe("você editou esta versão");
  });

  it("um mantenedor entre os editores não bloqueia o revisor", () => {
    const t = target({ status: "in_review", editors: [ { kind: "maintainer", id: ME, email: null } ] });

    expect(action(t, viewer("protocol_reviewer"), "sign").disabledReason).toBeNull();
  });

  it("quem já assinou a finalidade não assina de novo", () => {
    const t = target({
      status: "in_review",
      signatures: { publication: { signers: [ { id: ME, email: "eu@cidade.gov.br" } ], missing: 1 }, activation: { signers: [], missing: 2 } }
    });

    expect(action(t, viewer("protocol_reviewer"), "sign").disabledReason).toBe("você já assinou");
  });

  it("publicar e ativar dependem da finalidade certa", () => {
    const t = target({
      status: "in_review",
      signatures: { publication: { signers: [], missing: 1 }, activation: { signers: [], missing: 0 } }
    });
    expect(action(t, viewer("protocol_publisher"), "publish").disabledReason).toBe("falta 1 assinatura");

    const published = target({
      status: "published",
      signatures: { publication: { signers: [], missing: 0 }, activation: { signers: [], missing: 2 } }
    });
    expect(action(published, viewer("protocol_publisher"), "activate").disabledReason).toBe("faltam 2 assinaturas");
  });

  it("revisores insuficientes vencem o faltante", () => {
    const t = target({ status: "in_review", eligibleReviewers: 1 });

    expect(action(t, viewer("protocol_publisher"), "publish").disabledReason)
      .toBe("a cidade tem 1 revisor(es) elegível(is); são necessários 2");
  });

  it("enviar e aposentar nunca dependem de assinatura", () => {
    const t = target({ status: "draft", eligibleReviewers: 0 });

    expect(action(t, viewer("protocol_author"), "submit").disabledReason).toBeNull();
    expect(action(t, viewer("protocol_publisher"), "retire").disabledReason).toBeNull();
  });

  it("publicar com tudo pronto fica habilitado", () => {
    const t = target({
      status: "in_review",
      signatures: { publication: { signers: [], missing: 0 }, activation: { signers: [], missing: 2 } }
    });

    expect(action(t, viewer("protocol_publisher"), "publish").disabledReason).toBeNull();
  });
});

describe("shortfallMessage", () => {
  it("singular e plural, como Protocols::Signatures.shortfall_message", () => {
    expect(shortfallMessage(1)).toBe("falta 1 assinatura");
    expect(shortfallMessage(2)).toBe("faltam 2 assinaturas");
  });
});

describe("awaitingMySignature", () => {
  it("verdadeiro para o revisor que pode assinar agora", () => {
    expect(awaitingMySignature(target({ status: "in_review" }), viewer("protocol_reviewer"))).toBe(true);
    expect(awaitingMySignature(target({ status: "published" }), viewer("protocol_reviewer"))).toBe(true);
  });

  it("falso quando editou, quando já assinou, quando não é revisor e quando o status não pede", () => {
    const edited = target({ status: "in_review", editors: [ { kind: "user", id: ME, email: null } ] });
    const signed = target({
      status: "in_review",
      signatures: { publication: { signers: [ { id: ME, email: null } ], missing: 1 }, activation: { signers: [], missing: 2 } }
    });

    expect(awaitingMySignature(edited, viewer("protocol_reviewer"))).toBe(false);
    expect(awaitingMySignature(signed, viewer("protocol_reviewer"))).toBe(false);
    expect(awaitingMySignature(target({ status: "in_review" }), viewer("protocol_publisher"))).toBe(false);
    expect(awaitingMySignature(target({ status: "draft" }), viewer("protocol_reviewer"))).toBe(false);
  });

  it("o revisor que assinou a publicação ainda pode assinar a ativação", () => {
    const t = target({
      status: "published",
      signatures: { publication: { signers: [ { id: ME, email: null } ], missing: 1 }, activation: { signers: [], missing: 2 } }
    });

    expect(awaitingMySignature(t, viewer("protocol_reviewer"))).toBe(true);
  });
});
