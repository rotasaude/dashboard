import { describe, expect, it } from "vitest";
import { arrivalLabel, personLabel, priorityLabel, staleArrival } from "./queueLabels";

// Fuso da cidade em dev e teste: America/Sao_Paulo (UTC-3).
const now = new Date("2026-10-12T03:10:00Z"); // 00:10 de 12/10 em São Paulo

describe("chegada na fila", () => {
  it("hoje mostra só a hora; ontem diz ontem; antes, dia e hora", () => {
    expect(arrivalLabel("2026-10-12T03:05:00Z", now)).toBe("00:05");
    expect(arrivalLabel("2026-10-12T02:50:00Z", now)).toBe("ontem 23:50");
    expect(arrivalLabel("2026-10-09T14:00:00Z", now)).toBe("09/10 11:00");
  });

  it("chegada de outro dia ganha selo; hoje não", () => {
    expect(staleArrival("2026-10-12T03:05:00Z", now)).toBeNull();
    expect(staleArrival("2026-10-12T02:50:00Z", now)).toBe("chegou ontem");
    expect(staleArrival("2026-10-09T14:00:00Z", now)).toBe("há 3 dias");
  });
});

describe("prioridade e pessoa", () => {
  it("prioridade com rótulo, como no Acolhimento", () => {
    expect(priorityLabel(1)).toBe("prioridade 1");
    expect(priorityLabel(null)).toBe("—");
  });
  it("nome primeiro, CPF mascarado embaixo; sem nome, o CPF", () => {
    expect(personLabel({ display_name: "Luíza Alves", cpf_masked: "***.343.399-**" })).toEqual({ title: "Luíza Alves", sub: "***.343.399-**" });
    expect(personLabel({ display_name: null, cpf_masked: "***.343.399-**" })).toEqual({ title: "***.343.399-**", sub: null });
  });
});
