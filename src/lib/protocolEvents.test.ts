import { describe, expect, it } from "vitest";
import { actorLabel, eventLabel } from "./protocolEvents";

describe("eventos de protocolo em português (PR-11)", () => {
  it.each([
    [ "protocol.draft_saved", "rascunho salvo" ], [ "protocol.submitted", "enviada para revisão" ],
    [ "protocol.signed", "assinatura registrada" ], [ "protocol.published", "publicada" ],
    [ "protocol.activated", "ativada" ], [ "protocol.retired", "aposentada" ],
    [ "protocol.activation_reverted", "ativação revertida" ], [ "protocol.novo", "protocol.novo" ]
  ])("%s → %s", (name, label) => expect(eventLabel(name)).toBe(label));

  it("quem agiu: e-mail conhecido, mantenedor, pessoa da equipe ou sistema", () => {
    const people = [ { id: "u-a", email: "ana@c.gov" }, { id: "m-1", email: null, kind: "maintainer" } ];
    expect(actorLabel("u-a", people)).toBe("ana@c.gov");
    expect(actorLabel("m-1", people)).toBe("mantenedor");
    expect(actorLabel("u-x", people)).toBe("pessoa da equipe");
    expect(actorLabel(null, people)).toBe("sistema");
  });
});
