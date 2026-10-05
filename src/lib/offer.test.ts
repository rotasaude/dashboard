import { describe, expect, it } from "vitest";
import {
  parseRetake, protocolNameOf, readOffer, retakeLabel, suggestionProblem, writeOffer, writeSuggestions
} from "./offer";

const BASE = { name: "saude-do-idoso", version: 2, start_step_id: "s1", steps: [ { id: "s1", prompt: "?", answer_type: "boolean" } ] };
const FULL = {
  ...BASE,
  offer: { title: "Saúde do idoso", summary: "Quedas e memória.", eligibility: { gte: [ "profile.age", 60 ] }, retake_after_days: 365 },
  suggestions: [ { protocol: "saude-mental", when: { gte: [ "outcome.score", 15 ] } } ]
};
const EMPTY_OFFER = { title: "", summary: "", eligibility: null, retakeAfterDays: null };

describe("leitura", () => {
  it("sem offer nem suggestions: tudo vazio", () => {
    expect(readOffer(BASE)).toEqual({ ok: true, offer: EMPTY_OFFER, suggestions: [] });
  });

  it("lê o bloco inteiro", () => {
    expect(readOffer(FULL)).toEqual({
      ok: true,
      offer: { title: "Saúde do idoso", summary: "Quedas e memória.", eligibility: { gte: [ "profile.age", 60 ] }, retakeAfterDays: 365 },
      suggestions: [ { protocol: "saude-mental", when: { gte: [ "outcome.score", 15 ] } } ]
    });
  });

  it("sugestão sem when ou sem protocol é lida como incompleta", () => {
    expect(readOffer({ ...BASE, suggestions: [ {} ] })).toMatchObject({ ok: true, suggestions: [ { protocol: "", when: null } ] });
  });

  it.each([
    [ "definição que não é objeto", [], "a definição precisa ser um objeto JSON" ],
    [ "offer que não é objeto", { ...BASE, offer: "sim" }, `"offer" não é um objeto: corrija no JSON` ],
    [ "título que não é texto", { ...BASE, offer: { title: 3 } }, `"offer.title" precisa ser texto: corrija no JSON` ],
    [ "resumo que não é texto", { ...BASE, offer: { summary: [] } }, `"offer.summary" precisa ser texto: corrija no JSON` ],
    [ "elegibilidade que não é objeto", { ...BASE, offer: { eligibility: "60+" } }, `"offer.eligibility" precisa ser uma condição: corrija no JSON` ],
    [ "intervalo quebrado", { ...BASE, offer: { retake_after_days: 1.5 } }, `"offer.retake_after_days" precisa ser um número inteiro de dias: corrija no JSON` ],
    [ "suggestions que não é lista", { ...BASE, suggestions: {} }, `"suggestions" não é uma lista: corrija no JSON` ],
    [ "item fora do formato", { ...BASE, suggestions: [ { protocol: 1 } ] }, "uma sugestão está fora do formato { protocol, when }: corrija no JSON" ]
  ])("%s → recusa com motivo", (_name, def, reason) => {
    expect(readOffer(def)).toEqual({ ok: false, reason });
  });
});

describe("escrita", () => {
  it("campo vazio sai ausente; offer vazio sai inteiro; o resto da definição fica", () => {
    const next = writeOffer(FULL, { ...EMPTY_OFFER, title: "Idoso" }) as Record<string, unknown>;
    expect(next.offer).toEqual({ title: "Idoso" });
    expect(next.steps).toBe(FULL.steps);
    expect("offer" in (writeOffer(FULL, EMPTY_OFFER) as Record<string, unknown>)).toBe(false);
  });

  it("ida e volta mantém o bloco", () => {
    const read = readOffer(FULL);
    if (!read.ok) throw new Error("leitura falhou");
    expect(writeSuggestions(writeOffer(FULL, read.offer), read.suggestions)).toEqual(FULL);
  });

  it("sugestão sem condição sai sem when; lista vazia tira a chave", () => {
    expect((writeSuggestions(BASE, [ { protocol: "x-y", when: null } ]) as Record<string, unknown>).suggestions)
      .toEqual([ { protocol: "x-y" } ]);
    expect("suggestions" in (writeSuggestions(FULL, []) as Record<string, unknown>)).toBe(false);
  });

  it("nome do protocolo", () => {
    expect(protocolNameOf(FULL)).toBe("saude-do-idoso");
    expect(protocolNameOf({})).toBeNull();
  });
});

describe("intervalo e sugestões", () => {
  it("intervalo: vazio é sem intervalo; só inteiros de 1 a 3650", () => {
    expect(parseRetake("")).toEqual({ days: null, problem: null });
    expect(parseRetake(" 365 ")).toEqual({ days: 365, problem: null });
    expect(parseRetake("0")).toEqual({ days: null, problem: "use de 1 a 3650 dias" });
    expect(parseRetake("3651")).toEqual({ days: null, problem: "use de 1 a 3650 dias" });
    expect(parseRetake("1,5")).toEqual({ days: null, problem: "use um número inteiro de dias" });
  });

  it("rótulo do intervalo usa os atalhos", () => {
    expect(retakeLabel(null)).toBe("sem intervalo: pode refazer quando quiser");
    expect(retakeLabel(180)).toBe("6 meses (180 dias)");
    expect(retakeLabel(365)).toBe("1 ano (365 dias)");
    expect(retakeLabel(1)).toBe("1 dia");
    expect(retakeLabel(90)).toBe("90 dias");
  });

  it("sugestão incompleta, com nome inválido ou para si mesma é apontada", () => {
    const when = { gte: [ "outcome.score", 15 ] };
    expect(suggestionProblem({ protocol: "", when }, "a-b")).toBe("escolha o protocolo sugerido");
    expect(suggestionProblem({ protocol: "Saude", when }, "a-b")).toBe("nome de protocolo inválido (minúsculas, números e hífen)");
    expect(suggestionProblem({ protocol: "a-b", when }, "a-b")).toBe("um protocolo não pode sugerir a si mesmo");
    expect(suggestionProblem({ protocol: "c-d", when: null }, "a-b")).toBe("defina quando sugerir");
    expect(suggestionProblem({ protocol: "c-d", when }, "a-b")).toBeNull();
  });
});
