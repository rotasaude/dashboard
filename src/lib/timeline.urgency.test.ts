// Linha do tempo: fonte `urgency` (módulo 32a; contrato §10 e §14 Q27; preflight A25). O profissional vê o desfecho, a cor e o CID
// no título e no resumo do api; a entrada abre a consulta finalizada do 19a pelo caminho que já existe.
import { describe, expect, it } from "vitest";
import { detailTarget, statusLabel, timelineKindLabel, timelineKinds } from "./timeline";
import { entry } from "../test/timelineFixtures";

const urgency = entry({
  id: "urgency:en5", kind: "urgency", unit: { id: "upa1", name: "UPA Boqueirão" }, title: "Atendimento de urgência — UPA Boqueirão",
  summary: "amarelo · J06.9 Infecção aguda das vias aéreas superiores · Alta", status: "closed",
  detail_ref: { type: "consultation", id: "co1" }
});

describe("linha do tempo: urgência (módulo 32a)", () => {
  it("rótulo e filtro só com a urgência utilizável (7º parâmetro)", () => {
    expect(timelineKindLabel("urgency")).toBe("Urgência");
    expect(timelineKinds(false).some((k) => k.key === "urgency")).toBe(false);
    expect(timelineKinds(false, false, false, false, false, false, true).map((k) => k.key)).toContain("urgency");
  });
  it("abre a consulta do 19a, no contexto e pela abertura justificada; sem consulta finalizada, não abre", () => {
    expect(detailTarget(urgency, true)).toEqual({ type: "consultation", id: "co1" });
    expect(detailTarget(urgency, false)).toEqual({ type: "consultation", id: "co1" });
    expect(detailTarget({ ...urgency, detail_ref: null }, true)).toBeNull();
  });
  it("situação do encontro", () => {
    expect(statusLabel("waiting_classification")).toBe("aguardando classificação");
    expect(statusLabel("classified")).toBe("classificado");
    expect(statusLabel("in_care")).toBe("em atendimento");
    expect(statusLabel("closed")).toBe("encerrado");
  });
});
