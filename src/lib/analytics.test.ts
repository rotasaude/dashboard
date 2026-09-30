import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import {
  DEFAULT_RANGE, FORBIDDEN_TEXT, analyticsError, analyticsKey, dataUntil, fmtCell, fmtPeriod, fmtRate, mondayOf,
  plotValue, protocolOptions, rangeDates, rangeLabel, withGranularity
} from "./analytics";
import { AS_OF, HIDDEN, NOW, PROTOCOL_ROWS } from "../test/analyticsFixtures";

describe("célula e taxa", () => {
  it("contagem: número com milhar, zero e oculto", () => {
    expect(fmtCell(1234)).toBe("1.234");
    expect(fmtCell(0)).toBe("0");
    expect(fmtCell(HIDDEN)).toBe("oculto");
    expect(fmtCell(undefined)).toBe("—");
  });

  it("taxa: uma casa decimal com vírgula, oculto e sem dado", () => {
    expect(fmtRate(87.5)).toBe("87,5%");
    expect(fmtRate(100)).toBe("100,0%");
    expect(fmtRate(0)).toBe("0,0%");
    expect(fmtRate(HIDDEN)).toBe("oculto");
    expect(fmtRate(null)).toBe("sem dado");
  });

  it("no gráfico, oculto e sem dado viram lacuna, nunca zero", () => {
    expect([ 12, HIDDEN, null, 0, undefined ].map(plotValue)).toEqual([ 12, null, null, 0, null ]);
  });
});

describe("carimbo e rótulo de período", () => {
  it("dados até = dia da cidade do as_of, menos 1", () => {
    expect(dataUntil(AS_OF)).toBe("29/09");
  });

  it("as_of às 23h30 em São Paulo (dia seguinte em UTC) não adianta o carimbo", () => {
    // 02:30Z de 30/09 = 23:30 de 29/09 em São Paulo: consolidou até 28/09.
    expect(dataUntil("2026-09-30T02:30:00Z")).toBe("28/09");
  });

  it("sem as_of, ou lixo, não há carimbo", () => {
    expect(dataUntil(null)).toBeNull();
    expect(dataUntil("ontem")).toBeNull();
  });

  it("semana vira DD/MM e mês vira MM/AAAA, sem deslocar o dia", () => {
    expect(fmtPeriod("2026-09-28", "week")).toBe("28/09");
    expect(fmtPeriod("2026-09-01", "month")).toBe("09/2026");
  });
});

describe("intervalo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("semanas: termina ontem e começa numa segunda-feira", () => {
    expect(rangeDates(DEFAULT_RANGE)).toEqual({ from: "2026-07-13", to: "2026-09-29" });
    expect(rangeDates({ granularity: "week", count: 26 })).toEqual({ from: "2026-04-06", to: "2026-09-29" });
    expect(rangeDates({ granularity: "week", count: 104 })).toEqual({ from: "2024-10-07", to: "2026-09-29" });
  });

  it("meses: começa no dia 1", () => {
    expect(rangeDates({ granularity: "month", count: 6 })).toEqual({ from: "2026-04-01", to: "2026-09-29" });
    expect(rangeDates({ granularity: "month", count: 60 })).toEqual({ from: "2021-10-01", to: "2026-09-29" });
  });

  it("às 23h30 em São Paulo, ontem ainda é o dia anterior da cidade", () => {
    vi.setSystemTime(new Date("2026-10-01T02:30:00Z")); // 23:30 de 30/09 em São Paulo
    expect(rangeDates(DEFAULT_RANGE).to).toBe("2026-09-29");
  });

  it("segunda-feira da semana", () => {
    expect(mondayOf("2026-09-29")).toBe("2026-09-28");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
  });

  it("trocar o agrupamento mantém a contagem se ela existe na outra lista", () => {
    expect(withGranularity({ granularity: "week", count: 12 }, "month")).toEqual({ granularity: "month", count: 12 });
    expect(withGranularity({ granularity: "week", count: 26 }, "month")).toEqual({ granularity: "month", count: 6 });
    expect(withGranularity({ granularity: "month", count: 60 }, "week")).toEqual({ granularity: "week", count: 12 });
    expect(rangeLabel("week", 12)).toBe("últimas 12 semanas");
    expect(rangeLabel("month", 6)).toBe("últimos 6 meses");
  });
});

describe("chave e opções", () => {
  it("recorte nulo ou ausente dá a mesma chave de cache", () => {
    expect(analyticsKey("demand", { from: "a", to: "b", health_unit_id: null, neighborhood_id: undefined }))
      .toEqual(analyticsKey("demand", { from: "a", to: "b" }));
  });

  it("protocolos: sem rascunho, versões numéricas da maior para a menor, nomes em ordem", () => {
    expect(protocolOptions(PROTOCOL_ROWS)).toEqual([
      { name: "arbovirose", versions: [ 2, 1 ] },
      { name: "respiratorio", versions: [ 4 ] }
    ]);
  });
});

describe("recusas", () => {
  it("403 diz de quem é o Analytics", () => {
    expect(analyticsError(new ApiError(403, { error: "forbidden_role" }, "x"))).toBe(FORBIDDEN_TEXT);
  });

  it("422 traduz cada código; o resto é a frase genérica", () => {
    const e = (code: string) => analyticsError(new ApiError(422, { error: code }, "x"));
    expect(e("invalid_range")).toBe("Período inválido — escolha outro intervalo.");
    expect(e("invalid_neighborhood")).toBe("Esse bairro não existe nesta cidade — escolha outro.");
    expect(e("invalid_unit")).toBe("Essa unidade não existe nesta cidade — escolha outra.");
    expect(e("invalid_protocol")).toBe("Protocolo ou versão não encontrado — escolha outro.");
    expect(e("http_500")).toBe("não foi possível carregar — tente de novo");
    expect(analyticsError(new Error("rede"))).toBe("não foi possível carregar — tente de novo");
  });
});
