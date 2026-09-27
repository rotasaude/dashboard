import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { EventsData } from "../lib/types";
import { AS_OF, kpiRow, renderPanel, stubResizeObserver } from "../test/panelHarness";
import { Events } from "./Events";

beforeEach(() => stubResizeObserver());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const base: EventsData = {
  total: 4, retentionMonths: 12, replayAnchor: { seq: "evt_id=1", at: "2026-09-01T00:00:00Z" },
  byType: [ { name: "triage.completed", count: 4 } ],
  stream: [ { at: "2026-09-27T11:00:00Z", name: "triage.completed", actor: "sistema", ref: "triage_id=t-1", muni: null } ],
  filters: [ "todos", "triage.*" ]
};

// Cada chamada devolve a próxima resposta da fila (a última se repete):
// um EventsData vira 200 com envelope; { status, body } vira erro.
type Reply = EventsData | { status: number; body?: unknown };
function stubEvents(...replies: Reply[]) {
  let i = 0;
  const fn = vi.fn(async (_input: RequestInfo | URL) => {
    const reply = replies[Math.min(i++, replies.length - 1)];
    if ("status" in reply) {
      return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), {
        status: reply.status, headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ data: reply, as_of: AS_OF }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastParams(fn: ReturnType<typeof stubEvents>) {
  const calls = fn.mock.calls as unknown[][];
  return new URL(String(calls[calls.length - 1][0])).searchParams;
}

function paramsObject(fn: ReturnType<typeof stubEvents>) {
  return Object.fromEntries(lastParams(fn).entries());
}

describe("Events — filtros viram parâmetros da consulta (F-07.13)", () => {
  it("sem filtro, segue o período global e não manda from/to nem name", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);

    await kpiRow();
    expect(paramsObject(fn)).toEqual({ period: "7d" });
  });

  it("o chip manda o prefixo como name", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);

    fireEvent.click(await screen.findByRole("button", { name: "triage.*" }));
    await waitFor(() => expect(lastParams(fn).get("name")).toBe("triage.*"));
    expect(lastParams(fn).get("period")).toBe("7d");
  });

  it("a busca livre manda o nome exato ao enviar, e o chip todos a limpa", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("Nome do evento"), { target: { value: " consent.granted " } });
    expect(lastParams(fn).get("name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(lastParams(fn).get("name")).toBe("consent.granted"));

    // Volta à consulta sem nome (já em cache: não há nova chamada com name).
    const calls = fn.mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "todos" }));
    await kpiRow();
    expect((screen.getByLabelText("Nome do evento") as HTMLInputElement).value).toBe("");
    expect(fn.mock.calls.slice(calls).every((c) => !new URL(String((c as unknown[])[0])).searchParams.has("name"))).toBe(true);
  });

  it("a busca livre aceita prefixo com .*", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("Nome do evento"), { target: { value: "user.*" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(lastParams(fn).get("name")).toBe("user.*"));
  });
});

describe("Events — nome aplicado visível", () => {
  it("mostra no subtítulo o nome que a consulta usou, não o rascunho do campo", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("Nome do evento"), { target: { value: "consent.granted" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(lastParams(fn).get("name")).toBe("consent.granted"));
    fireEvent.change(screen.getByLabelText("Nome do evento"), { target: { value: "rascunho.x" } });

    const filtros = screen.getByRole("region", { name: "Filtros" });
    expect(filtros.textContent).toContain("período global · nome: consent.granted");
    expect(filtros.textContent).not.toContain("nome: rascunho.x");
  });

  it("limpar o nome aplicado volta a todos", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("Nome do evento"), { target: { value: "consent.granted" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(lastParams(fn).get("name")).toBe("consent.granted"));

    const calls = fn.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Limpar nome" }));
    await kpiRow();
    const filtros = screen.getByRole("region", { name: "Filtros" });
    expect(filtros.textContent).not.toContain("nome:");
    expect(screen.queryByRole("button", { name: "Limpar nome" })).toBeNull();
    expect(fn.mock.calls.slice(calls).every((c) => !new URL(String((c as unknown[])[0])).searchParams.has("name"))).toBe(true);
  });

  it("o chip aplicado também aparece no subtítulo", async () => {
    stubEvents(base);
    renderPanel(<Events />);

    fireEvent.click(await screen.findByRole("button", { name: "triage.*" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Filtros" }).textContent).toContain("nome: triage.*"));
  });
});

describe("Events — janela própria de tempo", () => {
  it("compara as datas como datas, não como texto (ano com 5 dígitos)", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "9999-12-31" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "10000-01-01" } });
    await waitFor(() => expect(paramsObject(fn)).toEqual({ period: "custom", from: "9999-12-31", to: "10000-01-01" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recusa de > até também com ano de 5 dígitos", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "10000-01-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "9999-12-31" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/data inicial/i);
    expect(paramsObject(fn)).toEqual({ period: "7d" });
  });

  it("com de/até preenchidos, manda period=custom com from e to", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-10" } });
    await waitFor(() => expect(paramsObject(fn)).toEqual({ period: "custom", from: "2026-09-01", to: "2026-09-10" }));
    expect(screen.getByText(/janela própria/i)).toBeTruthy();
  });

  it("só uma das datas: continua no período global", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    await kpiRow();
    expect(paramsObject(fn)).toEqual({ period: "7d" });
  });

  it("recusa de > até no cliente, sem mandar a janela", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-01" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/data inicial/i);
    expect(paramsObject(fn)).toEqual({ period: "7d" });
  });

  it("limpar a janela volta ao período global", async () => {
    const fn = stubEvents(base);
    renderPanel(<Events />);
    await kpiRow();

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-10" } });
    await waitFor(() => expect(lastParams(fn).get("period")).toBe("custom"));

    // Volta à consulta do período global (em cache: sem nova chamada custom).
    const calls = fn.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Usar período global" }));
    expect(await screen.findByText("período global")).toBeTruthy();
    await kpiRow();
    expect((screen.getByLabelText("De") as HTMLInputElement).value).toBe("");
    expect(fn.mock.calls.slice(calls).every((c) => new URL(String((c as unknown[])[0])).searchParams.get("period") === "7d")).toBe(true);
  });
});

describe("Events — estados", () => {
  it("vazio: mostra o total zero e o stream vazio", async () => {
    stubEvents({ ...base, total: 0, byType: [], stream: [], replayAnchor: null });
    renderPanel(<Events />);

    await kpiRow();
    expect(screen.getByText("nenhum evento no filtro atual")).toBeTruthy();
    expect(screen.getByText("sem eventos persistidos")).toBeTruthy();
    expect(screen.queryByText(/mais recentes/)).toBeNull();
  });

  it("422: mostra a mensagem da API e mantém os filtros para corrigir", async () => {
    stubEvents({ status: 422, body: { error: "invalid_scope", message: "datas inválidas" } });
    renderPanel(<Events />);

    expect(await screen.findByText(/datas inválidas/)).toBeTruthy();
    expect(screen.getByLabelText("De")).toBeTruthy();
    expect(screen.getByLabelText("Nome do evento")).toBeTruthy();
  });

  it("outro erro: estado de falha com tentar de novo", async () => {
    stubEvents({ status: 500 });
    renderPanel(<Events />);

    expect(await screen.findByRole("button", { name: /tentar/i })).toBeTruthy();
    expect(screen.getByLabelText("Nome do evento")).toBeTruthy();
  });

  it("acima de 50 no período, avisa que mostra só os 50 mais recentes", async () => {
    stubEvents({ ...base, total: 120 });
    renderPanel(<Events />);

    await kpiRow();
    expect(screen.getByText("mostrando os 50 mais recentes de 120")).toBeTruthy();
  });

  it("com 50 ou menos, não mostra o aviso", async () => {
    stubEvents({ ...base, total: 50 });
    renderPanel(<Events />);

    await kpiRow();
    expect(screen.queryByText(/mais recentes/)).toBeNull();
  });
});
