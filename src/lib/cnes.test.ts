import { describe, expect, it } from "vitest";
import {
  CONFIDENCE, PROPOSAL_ACTION_LABEL, PROPOSAL_KIND_LABEL, applySummary, describeSide, divergenceLabel, pruneSelection,
  subjectLabel, toggleAll, toggleOne
} from "./cnes";
import { proposal } from "../test/recordModeFixtures";

describe("CNES — rótulos", () => {
  it("tipo, ação e casamento", () => {
    expect(PROPOSAL_KIND_LABEL.unit).toBe("Unidade");
    expect(PROPOSAL_KIND_LABEL.member).toBe("Profissional na equipe");
    expect(PROPOSAL_ACTION_LABEL.end).toBe("encerrar (saiu do CNES)");
    expect(CONFIDENCE.probable).toEqual({ label: "provável — confira", tone: "warn" });
  });

  it("lado da proposta: só o que veio, CPF e CNS como vieram (mascarados)", () => {
    expect(describeSide({ name: "ANA SOUZA", ine: "0001234567", cbo: "225142", cpf_masked: "***.982.247-**", cns_masked: "7** **** **** 1234" }))
      .toBe("ANA SOUZA · INE 0001234567 · CBO 225142 · CPF ***.982.247-** · CNS 7** **** **** 1234");
    expect(describeSide({ name: "UBS CENTRO", cnes: "2384299", ine: null })).toBe("UBS CENTRO · CNES 2384299");
    expect(describeSide(null)).toBe("— (não existe no cadastro)");
    expect(describeSide({})).toBe("—");
  });

  it("divergência e assunto; desconhecido sai cru", () => {
    expect(divergenceLabel("no_bond_in_cnes")).toBe("profissional sem vínculo no CNES");
    expect(divergenceLabel("cbo_mismatch")).toBe("CBO diferente do CNES");
    expect(divergenceLabel("team_inactive_in_cnes")).toBe("equipe desativada no CNES");
    expect(divergenceLabel("unit_without_cnes")).toBe("unidade sem CNES");
    expect(divergenceLabel("other")).toBe("other");
    expect(subjectLabel({ type: "professional", label: "Bruno Lima" })).toBe("profissional · Bruno Lima");
    expect(subjectLabel({ type: "x", label: "Y" })).toBe("x · Y");
  });
});

describe("CNES — seleção", () => {
  const list = [ proposal({ id: "p1" }), proposal({ id: "p2" }) ];

  it("marca e desmarca uma; todas e nenhuma", () => {
    expect([ ...toggleOne(new Set(), "p1") ]).toEqual([ "p1" ]);
    expect([ ...toggleOne(new Set([ "p1" ]), "p1") ]).toEqual([]);
    expect([ ...toggleAll(new Set([ "p1" ]), list) ].sort()).toEqual([ "p1", "p2" ]);
    expect([ ...toggleAll(new Set([ "p1", "p2" ]), list) ]).toEqual([]);
    expect([ ...toggleAll(new Set(), []) ]).toEqual([]);
  });

  it("pruneSelection tira o que sumiu", () => {
    expect([ ...pruneSelection(new Set([ "p1", "gone" ]), list) ]).toEqual([ "p1" ]);
    expect([ ...pruneSelection(new Set([ "gone" ]), []) ]).toEqual([]);
  });

  it("applySummary diz as puladas", () => {
    expect(applySummary({ applied: 2, skipped: [] })).toBe("2 propostas aplicadas.");
    expect(applySummary({ applied: 1, skipped: [] })).toBe("1 proposta aplicada.");
    expect(applySummary({ applied: 0, skipped: [ { id: "p1", reason: "stale" } ] }))
      .toBe("Nenhuma proposta aplicada; 1 pulada porque mudou desde a leitura — confira a lista de novo.");
    expect(applySummary({ applied: 3, skipped: [ { id: "a", reason: "stale" }, { id: "b", reason: "stale" } ] }))
      .toBe("3 propostas aplicadas; 2 puladas porque mudaram desde a leitura — confira a lista de novo.");
  });

  it("applySummary separa conflito de cadastro", () => {
    const c = "por conflito com o cadastro da cidade (nome repetido ou profissional já ativo na equipe)";
    expect(applySummary({ applied: 0, skipped: [ { id: "a", reason: "conflict" } ] }))
      .toBe(`Nenhuma proposta aplicada; 1 pulada ${c} — confira a lista de novo.`);
    expect(applySummary({ applied: 2, skipped: [ { id: "a", reason: "conflict" }, { id: "b", reason: "conflict" } ] }))
      .toBe(`2 propostas aplicadas; 2 puladas ${c} — confira a lista de novo.`);
  });

  it("applySummary mistura stale e conflict, nessa ordem", () => {
    expect(applySummary({ applied: 1, skipped: [ { id: "b", reason: "conflict" }, { id: "a", reason: "stale" } ] }))
      .toBe("1 proposta aplicada; 1 pulada porque mudou desde a leitura; 1 pulada por conflito com o cadastro da cidade (nome repetido ou profissional já ativo na equipe) — confira a lista de novo.");
  });

  it("applySummary trata motivo desconhecido", () => {
    expect(applySummary({ applied: 1, skipped: [ { id: "a", reason: "weird" } ] }))
      .toBe("1 proposta aplicada; 1 pulada por outro motivo — confira a lista de novo.");
    expect(applySummary({ applied: 0, skipped: [ { id: "a", reason: "x" }, { id: "b", reason: "y" } ] }))
      .toBe("Nenhuma proposta aplicada; 2 puladas por outro motivo — confira a lista de novo.");
  });
});
