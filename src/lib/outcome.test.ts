import { describe, expect, it } from "vitest";
import { EMPTY_OUTCOME, outcomeBody, outcomeProblem, outcomeView } from "./outcome";

const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const units = [ unit, { id: "u2", name: "UBS Bairro Alto", kind: "ubs" }, { id: "u3", name: "Ambulatório de Especialidades", kind: "other" } ];

describe("desfecho do atendimento", () => {
  it("referência do bairro vem escolhida; a própria unidade nunca é referência", () => {
    const v = outcomeView({ ...EMPTY_OUTCOME, outcome: "referred" }, [ "u3", "u1" ], unit, units);
    expect(v.referenceUnits.map((u) => u.id)).toEqual([ "u3" ]);
    expect(v.referralUnitId).toBe("u3");
    expect(v.targetUnitName).toBe("Ambulatório de Especialidades");
  });

  it("escolher '—' vale mais que a sugestão; retorno é na própria unidade", () => {
    expect(outcomeView({ outcome: "referred", referralChoice: "", note: "" }, [ "u3" ], unit, units).referralUnitId).toBe("");
    expect(outcomeView({ ...EMPTY_OUTCOME, outcome: "return" }, [], unit, units).targetUnitName).toBe("UBS Centro");
    expect(outcomeView(EMPTY_OUTCOME, [], unit, units).targetUnitName).toBeUndefined();
  });

  it("encaminhar pede unidade ou descrição", () => {
    expect(outcomeProblem({ outcome: "referred", referralChoice: null, note: "" }, "")).toBe(
      "informe a unidade de destino ou a descrição do encaminhamento");
    expect(outcomeProblem({ outcome: "referred", referralChoice: null, note: "cardiologia" }, "")).toBeNull();
    expect(outcomeProblem(EMPTY_OUTCOME, "")).toBeNull();
  });

  it("corpo igual ao do close de hoje", () => {
    expect(outcomeBody(EMPTY_OUTCOME, "u3")).toEqual({ outcome: "discharged" });
    expect(outcomeBody({ outcome: "referred", referralChoice: null, note: "" }, "u3")).toEqual({ outcome: "referred", referral_unit_id: "u3" });
    expect(outcomeBody({ outcome: "return", referralChoice: null, note: "trazer exames" }, "")).toEqual({ outcome: "return", referral_note: "trazer exames" });
  });
});
