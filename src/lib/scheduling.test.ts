import { describe, expect, it } from "vitest";
import {
  addDaysIso, appointmentFlags, blockLine, blockProblem, confirmationWarning, dayLabel, daysBetween, fmtDueOn,
  MAX_BLOCKS, NAME_MAX, overlappingBlocks, parseCboPrefixes, parseFitInLimit, requestKindLabel, requestMarks, slotsByDay, statusLabel, templateDraftFrom,
  templateProblem, typeDraftFrom, typeDraftProblem, typeLabel, typeServes, weekStart
} from "./scheduling";
import type { ScheduleBlock } from "./api";
import { appointmentView, MORNING, slot, TYPES } from "../test/schedulingFixtures";

describe("faixas do modelo", () => {
  it.each([
    [ { starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "consulta_medica" }, null ],
    [ { starts: "07:00", ends: "09:00", kind: "walk_in" }, null ],
    [ { starts: "11:00", ends: "11:00", kind: "blocked" }, "crosses_midnight" ],
    [ { starts: "22:00", ends: "02:00", kind: "blocked" }, "crosses_midnight" ],
    [ { starts: "23:00", ends: "24:00", kind: "walk_in" }, "crosses_midnight" ],
    [ { starts: "7:00", ends: "09:00", kind: "walk_in" }, "bad_time" ],
    [ { starts: "09:00", ends: "25:00", kind: "walk_in" }, "bad_time" ],
    [ { starts: "09:00", ends: "11:00", kind: "bookable" }, "missing_type" ],
    [ { starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "nao_existe" }, "unknown_type" ],
    [ { starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "consulta_medica", slot_minutes: 4 }, "bad_slot_minutes" ],
    [ { starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "consulta_medica", slot_minutes: 241 }, "bad_slot_minutes" ],
    // api: tipo ou slot_minutes em faixa que não é agendável é bad_block (template_blocks.rb).
    [ { starts: "09:00", ends: "11:00", kind: "walk_in", slot_minutes: 30 }, "bad_block" ],
    [ { starts: "09:00", ends: "11:00", kind: "blocked", appointment_type_key: "consulta_medica" }, "bad_block" ]
  ] as const)("%j → %s", (block, expected) => {
    expect(blockProblem(block, TYPES)).toBe(expected);
  });

  it("tipo inativo é inactive_type, não unknown_type", () => {
    expect(blockProblem({ starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "puericultura" }, TYPES))
      .toBe("inactive_type");
  });

  it("sobreposição marca as duas faixas; encostar não é sobrepor", () => {
    expect([ ...overlappingBlocks(MORNING.blocks) ]).toEqual([]);
    const blocks = [ ...MORNING.blocks, { starts: "10:30", ends: "11:30", kind: "blocked" as const } ];
    expect([ ...overlappingBlocks(blocks) ].sort()).toEqual([ 1, 2, 3 ]);
  });

  it("limite de encaixes: inteiro de 0 a 20", () => {
    expect(parseFitInLimit("0")).toBe(0);
    expect(parseFitInLimit("20")).toBe(20);
    expect(parseFitInLimit("21")).toBeNull();
    expect(parseFitInLimit("1,5")).toBeNull();
    expect(parseFitInLimit("")).toBeNull();
  });

  it("modelo: primeiro problema em frase", () => {
    const ok = templateDraftFrom(MORNING);
    expect(templateProblem(ok, TYPES)).toBeNull();
    expect(templateProblem({ ...ok, name: "  " }, TYPES)).toBe("dê um nome ao modelo");
    expect(templateProblem({ ...ok, fitInLimit: "30" }, TYPES)).toBe("limite de encaixes entre 0 e 20");
    expect(templateProblem({ ...ok, blocks: [] }, TYPES)).toBe("inclua pelo menos uma faixa");
    expect(templateProblem({ ...ok, blocks: [ { starts: "19:00", ends: "07:00", kind: "walk_in" } ] }, TYPES))
      .toBe("a faixa não cruza a meia-noite — use fim depois do início (sem 24:00)");
    expect(templateProblem({ ...ok, blocks: [ ...ok.blocks, { starts: "08:00", ends: "09:30", kind: "blocked" } ] }, TYPES))
      .toBe("faixas sobrepostas — ajuste os horários");
    expect(templateProblem({ ...ok, blocks: [ { starts: "09:00", ends: "11:00", kind: "bookable" } ] }, TYPES))
      .toBe("faixa agendável precisa de um tipo de atendimento");
  });

  it("modelo: nome de até 60 caracteres depois de juntar os espaços (squish do api)", () => {
    const ok = templateDraftFrom(MORNING);
    expect(NAME_MAX).toBe(60);
    expect(templateProblem({ ...ok, name: "a".repeat(60) }, TYPES)).toBeNull();
    expect(templateProblem({ ...ok, name: `  ${"a".repeat(30)}   ${"b".repeat(29)}  ` }, TYPES)).toBeNull();
    expect(templateProblem({ ...ok, name: "a".repeat(61) }, TYPES)).toBe("nome do modelo com até 60 caracteres");
  });

  it("modelo: no máximo 24 faixas", () => {
    expect(MAX_BLOCKS).toBe(24);
    const many = (n: number): ScheduleBlock[] =>
      Array.from({ length: n }, (_, i) => ({ starts: `${String(i).padStart(2, "0")}:00`, ends: `${String(i).padStart(2, "0")}:30`, kind: "walk_in" as const }));
    const ok = templateDraftFrom(MORNING);
    expect(templateProblem({ ...ok, blocks: many(24) }, TYPES)).toBeNull();
    const tooMany = [ ...many(24), { starts: "23:30", ends: "23:45", kind: "walk_in" as const } ];
    expect(templateProblem({ ...ok, blocks: tooMany }, TYPES)).toBe("no máximo 24 faixas por modelo");
  });

  it("modelo novo começa com uma faixa agendável sem tipo e limite 2", () => {
    expect(templateDraftFrom(null)).toEqual({ name: "", fitInLimit: "2", blocks: [ { starts: "08:00", ends: "12:00", kind: "bookable" } ] });
  });

  it("linha da faixa em frase, com o nome do tipo", () => {
    expect(blockLine(MORNING.blocks[1], TYPES)).toBe("09:00–11:00 · agendável · Consulta médica");
    expect(blockLine(MORNING.blocks[0], TYPES)).toBe("07:00–09:00 · demanda do dia");
    expect(blockLine({ starts: "09:00", ends: "10:00", kind: "bookable", appointment_type_key: "puericultura", slot_minutes: 30 }, TYPES))
      .toBe("09:00–10:00 · agendável · Puericultura (inativo) · vagas de 30 min");
    expect(blockLine(MORNING.blocks[1], null)).toBe("09:00–11:00 · agendável · consulta_medica");
    // Respostas de agenda trazem o nome na faixa (contratos §9): sem lista de tipos, vale o nome.
    expect(blockLine({ ...MORNING.blocks[1], appointment_type_name: "Consulta médica" }, null))
      .toBe("09:00–11:00 · agendável · Consulta médica");
  });
});

describe("tipos de atendimento", () => {
  it("CBOs: lista separada por vírgula ou espaço, só dígitos (1 a 6)", () => {
    expect(parseCboPrefixes("2251, 2252 2253")).toEqual([ "2251", "2252", "2253" ]);
    expect(parseCboPrefixes("")).toBeNull();
    expect(parseCboPrefixes("22a1")).toBeNull();
    expect(parseCboPrefixes("1234567")).toBeNull();
    expect(parseCboPrefixes(Array.from({ length: 20 }, (_, i) => String(2200 + i)).join(","))).toHaveLength(20);
    expect(parseCboPrefixes(Array.from({ length: 21 }, (_, i) => String(2200 + i)).join(","))).toBeNull();
  });

  it("rascunho: chave só na criação, duração 5–240, nome e CBO obrigatórios", () => {
    const draft = { key: "puericultura", name: "Puericultura", duration: "30", cbo: "2235" };
    expect(typeDraftProblem(draft, "create")).toBeNull();
    expect(typeDraftProblem({ ...draft, key: "Puericultura" }, "create")).toBe("chave: minúsculas, números e _, começando por letra (2 a 41)");
    expect(typeDraftProblem({ ...draft, key: "x" }, "edit")).toBeNull();
    expect(typeDraftProblem({ ...draft, name: "" }, "create")).toBe("dê um nome ao tipo");
    expect(typeDraftProblem({ ...draft, duration: "4" }, "create")).toBe("duração entre 5 e 240 minutos");
    expect(typeDraftProblem({ ...draft, cbo: "x" }, "create")).toBe("informe de 1 a 20 grupos de CBO (só números, separados por vírgula)");
    expect(typeDraftFrom(TYPES[0])).toEqual({ key: "consulta_medica", name: "Consulta médica", duration: "20", cbo: "2251, 2252, 2253" });
  });

  it("rascunho: nome do tipo com até 60 caracteres", () => {
    const draft = { key: "puericultura", name: "a".repeat(60), duration: "30", cbo: "2235" };
    expect(typeDraftProblem(draft, "create")).toBeNull();
    expect(typeDraftProblem({ ...draft, name: "a".repeat(61) }, "edit")).toBe("nome do tipo com até 60 caracteres");
  });

  it("rótulo do tipo: nome, (inativo), ou a chave quando não existe", () => {
    expect(typeLabel("consulta_medica", TYPES)).toBe("Consulta médica");
    expect(typeLabel("puericultura", TYPES)).toBe("Puericultura (inativo)");
    expect(typeLabel("sumiu", TYPES)).toBe("sumiu (não existe na cidade)");
    expect(typeLabel(null, TYPES)).toBe("—");
    expect(typeLabel("consulta_medica", null)).toBe("consulta_medica");
  });
});

describe("datas no fuso da cidade", () => {
  it("vaga das 23h30 fica no dia da cidade, não no dia UTC", () => {
    const late = slot({ starts_at: "2026-10-07T02:30:00Z", ends_at: "2026-10-07T02:50:00Z" });
    const map = slotsByDay([ slot(), late ]);
    expect([ ...map.keys() ]).toEqual([ "2026-10-06" ]);
    expect(map.get("2026-10-06")).toHaveLength(2);
  });

  it("semana começa na segunda; dias e rótulos", () => {
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-05", "2026-10-07")).toEqual([ "2026-10-05", "2026-10-06", "2026-10-07" ]);
    expect(dayLabel("2026-10-06")).toBe("ter 06/10");
    expect(fmtDueOn("2026-10-20")).toBe("até 20/10");
  });

  it("aviso de confirmação: menos de 48h nasce confirmado; senão prazo = horário − 24h", () => {
    const now = new Date("2026-10-05T10:00:00-03:00");
    expect(confirmationWarning(new Date("2026-10-06T09:00:00-03:00"), now)).toBe("O horário nasce confirmado");
    expect(confirmationWarning(new Date("2026-10-08T14:30:00-03:00"), now)).toBe("O cidadão precisa confirmar até 07/10 14:30");
  });
});

describe("fila e agenda", () => {
  it("marcas do pedido, na ordem: atrasado, pediu outro horário, precisa remarcar, reaberto", () => {
    const base = { overdue: false, reschedule_requested: false, needs_reschedule: false, reopened_reason: null };
    expect(requestMarks(base)).toEqual([]);
    expect(requestMarks({ overdue: true, reschedule_requested: true, needs_reschedule: true, reopened_reason: "no_show" }))
      .toEqual([
        { label: "atrasado", tone: "down" },
        { label: "pediu outro horário", tone: "warn" },
        { label: "precisa remarcar", tone: "warn" },
        { label: "faltou", tone: "neutral" }
      ]);
    expect(requestMarks({ ...base, reopened_reason: "expired" })).toEqual([ { label: "sem confirmação", tone: "neutral" } ]);
  });

  it("marcas do horário: encaixe, fora do modelo, turno cancelado", () => {
    expect(appointmentFlags(appointmentView())).toEqual([]);
    expect(appointmentFlags(appointmentView({ fit_in: true, outside_template: true, shift_cancelled: true })))
      .toEqual([ "encaixe", "fora do modelo", "turno cancelado" ]);
  });
});

describe("tipo serve o CBO", () => {
  it("por prefixo do grupo", () => {
    expect(typeServes(TYPES[0], "225125")).toBe(true);
    expect(typeServes(TYPES[0], "223505")).toBe(false);
    expect(typeServes(TYPES[1], "223505")).toBe(true);
  });
});

describe("rótulo do pedido", () => {
  it("retorno, encaminhamento com e sem unidade de origem, triagem", () => {
    expect(requestKindLabel({ kind: "return", origin_unit_name: "UBS Centro" })).toBe("Retorno");
    expect(requestKindLabel({ kind: "referral", origin_unit_name: "UPA Norte" })).toBe("Encaminhado de UPA Norte");
    expect(requestKindLabel({ kind: "referral", origin_unit_name: null })).toBe("Encaminhamento");
    expect(requestKindLabel({ kind: "triage", origin_unit_name: null })).toBe("Triagem");
  });
});

describe("estado do horário", () => {
  it("rótulos de hoje; código novo aparece como veio", () => {
    expect(statusLabel("scheduled")).toBe("aguardando confirmação");
    expect(statusLabel("moved")).toBe("movido para outra unidade");
    expect(statusLabel("algo_novo")).toBe("algo_novo");
  });
});
