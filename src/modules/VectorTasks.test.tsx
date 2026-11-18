// src/modules/VectorTasks.test.tsx
// "Tarefas de endemias" da coordenação (módulo 35a, Task 16; contrato §6, §8, §17; Q9): as tarefas que o api abre (intensificação
// de ovitrampa acima do alerta, caso de residente de outro município, caso do bloqueio sem quarteirão), em duas abas com o próprio
// cursor; "Concluir" e "Dispensar" com nota 10–500 → POST /tasks/:id/close { state, note }. Depois de encerrar, a lista é relida
// UMA vez; 409 invalid_transition / 404 / rede: a frase, UMA releitura, nenhum reenvio. Nunca paciente; nada em URL ou storage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), listVectorTasks: vi.fn(), closeVectorTask: vi.fn(), getVectorDomains: vi.fn(),
    getVectorParameters: vi.fn(), listTransmissionBlocks: vi.fn(), getVectorDiseases: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type VectorTask } from "../lib/api";
import { VC_NO_ROLE } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { expectFrozenNotice } from "../test/frozenNotice";
import { VC_DISEASES, vcUser, vectorTask } from "../test/vectorControlFixtures";
import { CLOSED_EMPTY, OPEN_EMPTY, TASK_DISMISSED, TASK_DONE, TASK_GONE, TASK_UNCERTAIN, VectorTasks } from "./VectorTasks";

const ALL = [
  api.fetchCurrentSession, api.listVectorTasks, api.closeVectorTask, api.getVectorDomains, api.getVectorParameters, api.listTransmissionBlocks,
  api.getVectorDiseases
];
const INT = vectorTask({
  id: "vt1", kind: "ovitrap_intensification", created_at: "2026-11-15T12:00:00Z", ovitrap: { id: "ov12", number: "OV-12" },
  suggested_blocks: [ { id: "cb12", number: "12" }, { id: "cb13", number: "13" }, { id: "cb14", number: "14" } ]
});
const ELSE = vectorTask({
  id: "vt2", kind: "case_resident_elsewhere", created_at: "2026-11-14T12:00:00Z", ovitrap: null, suggested_blocks: [], disease: "A90",
  case_on: "2026-11-10"
});
const NOPLACE = vectorTask({
  id: "vt3", kind: "block_case_without_place", created_at: "2026-11-13T12:00:00Z", ovitrap: null, suggested_blocks: [], transmission_block_id: "tb9"
});
const EXTRA = vectorTask({ id: "vt4", kind: "ovitrap_intensification", created_at: "2026-11-12T12:00:00Z", ovitrap: { id: "ov99", number: "OV-99" },
  suggested_blocks: [ { id: "cb20", number: "20" } ] });
const DONE1 = vectorTask({
  id: "vt8", state: "done", created_at: "2026-11-10T12:00:00Z", closed_at: "2026-11-16T11:00:00Z", ovitrap: { id: "ov7", number: "OV-07" },
  suggested_blocks: [ { id: "cb2", number: "13" } ]
});
const DISM1 = vectorTask({
  id: "vt9", kind: "case_resident_elsewhere", state: "dismissed", created_at: "2026-11-09T12:00:00Z", closed_at: "2026-11-15T11:00:00Z",
  ovitrap: null, suggested_blocks: [], disease: "A92.0", case_on: "2026-11-05"
});
const page = (items: VectorTask[], next_before: string | null = null) => ({ items, next_before });

afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); });
beforeEach(() => {
  for (const f of ALL) vi.mocked(f as ReturnType<typeof vi.fn>).mockReset();
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
  vi.mocked(api.listVectorTasks).mockImplementation(async (q) => (q.state === "open" ? page([ INT, ELSE, NOPLACE ]) : page([ DONE1, DISM1 ])));
});

const tick = () => new Promise((r) => setTimeout(r, 20));
const OPEN = "Tarefas abertas";
const CLOSED = "Tarefas encerradas";
const card = (text: string) => {
  const el = screen.getByText(text).closest("article");
  if (!el) throw new Error(`sem cartão para ${text}`);
  return within(el as HTMLElement);
};
const states = () => vi.mocked(api.listVectorTasks).mock.calls.map(([ q ]) => q.state);
// A releitura da aba aberta traz EXTRA: esperar OV-99 é esperar a releitura; depois, a contagem exata.
function rereadBrings(after: VectorTask[] = [ ELSE, NOPLACE, EXTRA ]) {
  let first = true;
  vi.mocked(api.listVectorTasks).mockImplementation(async (q) => {
    if (q.state !== "open") return page([ DONE1, DISM1 ]);
    const items = first ? [ INT, ELSE, NOPLACE ] : after;
    first = false;
    return page(items);
  });
}
async function openClose(button: "Concluir" | "Dispensar", ovitrap = "OV-12") {
  await screen.findByRole("list", { name: OPEN });
  fireEvent.click(card(ovitrap).getByRole("button", { name: button }));
  return screen.findByLabelText("Nota");
}
const note = (v: string) => fireEvent.change(screen.getByLabelText("Nota"), { target: { value: v } });

describe("VectorTasks", () => {
  it("intensificação mostra a ovitrampa \"OV-12\" e \"Quarteirões 12, 13 e 14\"; caso de fora com doença e data; nenhuma tarefa mostra paciente", async () => {
    const nav = vi.fn();
    // Um campo a mais (que o api nunca manda) não aparece: a tela só mostra o que conhece.
    const leaky = { ...ELSE, patient: { name: "Maria da Silva", cpf: "123.456.789-00" }, address_short: "Rua das Flores, 120" } as unknown as VectorTask;
    vi.mocked(api.listVectorTasks).mockImplementation(async (q) => (q.state === "open" ? page([ INT, leaky, NOPLACE ]) : page([])));
    renderWithProviders(<VectorTasks onOpenTransmission={nav} />);
    for (const name of [ "Abertas", "Encerradas" ]) expect(await screen.findByRole("tab", { name })).not.toBeNull();
    await screen.findByRole("list", { name: OPEN });

    const intens = card("OV-12");
    expect(intens.getByText("Intensificar em torno da ovitrampa")).not.toBeNull();
    expect(intens.getByText("Quarteirões 12, 13 e 14")).not.toBeNull();
    expect(intens.getByText("criada em 15/11/2026, 09:00")).not.toBeNull();
    expect(intens.queryByRole("button", { name: "Abrir o bloqueio" })).toBeNull();

    const elsewhere = card("Caso de residente de outro município");
    expect(elsewhere.getByText("A90")).not.toBeNull();
    expect(elsewhere.getByText("10/11/2026")).not.toBeNull();
    expect(elsewhere.queryByText(/OV-|Quarteir/)).toBeNull();

    const noPlace = card("Caso de bloqueio sem quarteirão");
    fireEvent.click(noPlace.getByRole("button", { name: "Abrir o bloqueio" }));
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith();
    expect(screen.getAllByRole("button", { name: "Abrir o bloqueio" })).toHaveLength(1);

    expect(api.listVectorTasks).toHaveBeenCalledTimes(1);
    expect(api.listVectorTasks).toHaveBeenCalledWith({ state: "open" });
    expect(api.getVectorDomains).not.toHaveBeenCalled();
    expect(api.getVectorParameters).not.toHaveBeenCalled();
    expect(api.listTransmissionBlocks).not.toHaveBeenCalled();
    // Sem paciente, sem endereço, sem "caso N" (a tarefa não traz número de caso); nada em URL ou storage.
    expect(document.body.textContent).not.toMatch(/Maria|123\.456|Rua das Flores|paciente|patient|cpf|caso \d/i);
    expect(window.location.search).toBe("");
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("concluir sem nota não envia; com nota manda { state: \"done\", note } uma vez no duplo clique e relê a lista uma vez", async () => {
    rereadBrings();
    let resolve!: (t: VectorTask) => void;
    vi.mocked(api.closeVectorTask).mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderWithProviders(<VectorTasks />);
    await openClose("Concluir");
    expectFrozenNotice(screen.getByLabelText("Nota"));

    fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
    expect(await screen.findByText("escreva de 10 a 500 caracteres")).not.toBeNull();
    expect(screen.getByLabelText("Nota").getAttribute("aria-invalid")).toBe("true");
    note("   curta   ");
    fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
    await tick();
    expect(screen.getByLabelText("Nota").getAttribute("aria-invalid")).toBe("true");
    expect(api.closeVectorTask).not.toHaveBeenCalled();

    note("  Quarteirões vistoriados na semana  ");
    const submit = screen.getByRole("button", { name: "Concluir tarefa" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.closeVectorTask).toHaveBeenCalledTimes(1);
    expect(api.closeVectorTask).toHaveBeenCalledWith("vt1", { state: "done", note: "Quarteirões vistoriados na semana" });
    expect(JSON.stringify(vi.mocked(api.closeVectorTask).mock.calls[0][1])).toBe('{"state":"done","note":"Quarteirões vistoriados na semana"}');
    resolve({ ...INT, state: "done", closed_at: "2026-11-16T13:00:00Z" });
    expect(await screen.findByText(TASK_DONE)).not.toBeNull();
    await screen.findByText("OV-99");
    await tick();
    expect(states()).toEqual([ "open", "open" ]);
    expect(screen.queryByText("OV-12")).toBeNull();
    expect(screen.queryByLabelText("Nota")).toBeNull();
    // A nota nunca sai do campo.
    expect(document.body.textContent).not.toContain("vistoriados");

    // "Encerradas" lê uma vez ao ser aberta (a montagem já é a releitura); voltar e ir de novo não relê.
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await screen.findByRole("list", { name: CLOSED });
    fireEvent.click(screen.getByRole("tab", { name: "Abertas" }));
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await tick();
    expect(states()).toEqual([ "open", "open", "closed" ]);
  });

  it("dispensar manda { state: \"dismissed\", note }; Cancelar não envia e não relê", async () => {
    rereadBrings();
    vi.mocked(api.closeVectorTask).mockResolvedValue({ ...INT, state: "dismissed", closed_at: "2026-11-16T13:00:00Z" });
    renderWithProviders(<VectorTasks />);
    await openClose("Dispensar");
    note("Ovitrampa já intensificada");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Nota")).toBeNull();
    await tick();
    expect(api.closeVectorTask).not.toHaveBeenCalled();
    expect(api.listVectorTasks).toHaveBeenCalledTimes(1);

    await openClose("Dispensar");
    note("Ovitrampa já intensificada pela equipe");
    fireEvent.click(screen.getByRole("button", { name: "Dispensar tarefa" }));
    expect(await screen.findByText(TASK_DISMISSED)).not.toBeNull();
    expect(api.closeVectorTask).toHaveBeenCalledTimes(1);
    expect(api.closeVectorTask).toHaveBeenCalledWith("vt1", { state: "dismissed", note: "Ovitrampa já intensificada pela equipe" });
    await screen.findByText("OV-99");
    await tick();
    expect(api.listVectorTasks).toHaveBeenCalledTimes(2);
  });

  // A releitura de "Encerradas" traz a tarefa recém-concluída (OV-12): esperar o cartão é esperar a releitura.
  function closedRereadBrings() {
    let openFirst = true;
    let closedFirst = true;
    const INT_DONE = { ...INT, state: "done", closed_at: "2026-11-16T13:00:00Z" };
    vi.mocked(api.listVectorTasks).mockImplementation(async (q) => {
      if (q.state === "open") { const items = openFirst ? [ INT, ELSE, NOPLACE ] : [ ELSE, NOPLACE ]; openFirst = false; return page(items); }
      const items = closedFirst ? [ DONE1, DISM1 ] : [ INT_DONE, DONE1, DISM1 ];
      closedFirst = false;
      return page(items);
    });
    vi.mocked(api.closeVectorTask).mockResolvedValue(INT_DONE);
  }
  async function mountWithClosedTab() {
    renderWithProviders(<VectorTasks />);
    await screen.findByRole("list", { name: OPEN });
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await screen.findByRole("list", { name: CLOSED });
    fireEvent.click(screen.getByRole("tab", { name: "Abertas" }));
    expect(states()).toEqual([ "open", "closed" ]);
  }

  it("concluir com Encerradas já montada e escondida: ela relê exatamente uma vez ao voltar e mostra a tarefa", async () => {
    closedRereadBrings();
    await mountWithClosedTab();
    await openClose("Concluir");
    note("Quarteirões vistoriados na semana");
    fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
    expect(await screen.findByText(TASK_DONE)).not.toBeNull();
    await waitFor(() => expect(within(screen.getByRole("list", { name: OPEN })).queryByText("OV-12")).toBeNull());
    await tick();
    // Escondida, "Encerradas" não relê ainda.
    expect(states()).toEqual([ "open", "closed", "open" ]);

    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    const closedList = within(screen.getByRole("list", { name: CLOSED }));
    expect(await closedList.findByText("OV-12")).not.toBeNull();
    expect(card("OV-12").getByText("concluída")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Abertas" }));
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await tick();
    expect(states()).toEqual([ "open", "closed", "open", "closed" ]);
    expect(api.closeVectorTask).toHaveBeenCalledTimes(1);
  });

  it("concluir com o envio em voo e Encerradas à vista quando ele termina: ela relê exatamente uma vez na hora", async () => {
    closedRereadBrings();
    let resolve!: (t: VectorTask) => void;
    const INT_DONE = { ...INT, state: "done", closed_at: "2026-11-16T13:00:00Z" };
    vi.mocked(api.closeVectorTask).mockImplementation(() => new Promise((r) => { resolve = r; }));
    await mountWithClosedTab();
    await openClose("Concluir");
    note("Quarteirões vistoriados na semana");
    fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    resolve(INT_DONE);
    const closedList = within(screen.getByRole("list", { name: CLOSED }));
    expect(await closedList.findByText("OV-12")).not.toBeNull();
    await tick();
    expect([ ...states() ].sort()).toEqual([ "closed", "closed", "open", "open" ]);
    fireEvent.click(screen.getByRole("tab", { name: "Abertas" }));
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await tick();
    expect(api.listVectorTasks).toHaveBeenCalledTimes(4);
    expect(api.closeVectorTask).toHaveBeenCalledTimes(1);
  });

  it("invalid_transition relê uma vez: a frase, um envio, o formulário fechado; Encerradas, já aberta, relê uma vez ao voltar", async () => {
    rereadBrings();
    vi.mocked(api.closeVectorTask).mockRejectedValue(new ApiError(409, { error: "invalid_transition", path: "status" }, "x"));
    renderWithProviders(<VectorTasks />);
    await screen.findByRole("list", { name: OPEN });
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await screen.findByRole("list", { name: CLOSED });
    fireEvent.click(screen.getByRole("tab", { name: "Abertas" }));
    expect(states()).toEqual([ "open", "closed" ]);

    await openClose("Concluir");
    note("Quarteirões vistoriados na semana");
    fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
    expect(await screen.findByText(VECTOR_ERRORS.invalid_transition)).not.toBeNull();
    await screen.findByText("OV-99");
    await tick();
    expect(api.closeVectorTask).toHaveBeenCalledTimes(1);
    expect(states()).toEqual([ "open", "closed", "open" ]);
    expect(screen.queryByLabelText("Nota")).toBeNull();
    expect(document.body.textContent).not.toContain("invalid_transition");

    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await waitFor(() => expect(states()).toEqual([ "open", "closed", "open", "closed" ]));
    fireEvent.click(screen.getByRole("tab", { name: "Abertas" }));
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await tick();
    expect(states()).toEqual([ "open", "closed", "open", "closed" ]);
    expect(api.closeVectorTask).toHaveBeenCalledTimes(1);
  });

  it("404 e rede/503: a frase própria, uma releitura, um envio", async () => {
    const cases: [ unknown, string ][] = [
      [ new ApiError(404, { error: "not_found" }, "x"), TASK_GONE ],
      [ new TypeError("Failed to fetch"), TASK_UNCERTAIN ],
      [ new ApiError(503, null, "x"), TASK_UNCERTAIN ]
    ];
    for (const [ err, text ] of cases) {
      rereadBrings();
      vi.mocked(api.closeVectorTask).mockReset();
      vi.mocked(api.closeVectorTask).mockRejectedValue(err);
      renderWithProviders(<VectorTasks />);
      await openClose("Concluir");
      note("Quarteirões vistoriados na semana");
      fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
      expect(await screen.findByText(text)).not.toBeNull();
      await screen.findByText("OV-99");
      await tick();
      expect(api.closeVectorTask).toHaveBeenCalledTimes(1);
      expect(api.listVectorTasks).toHaveBeenCalledTimes(2);
      expect(screen.queryByLabelText("Nota")).toBeNull();
      cleanup();
      vi.mocked(api.listVectorTasks).mockReset();
    }
  });

  it("recusa da nota pelo api vai ao campo, sem releitura; o digitado fica", async () => {
    vi.mocked(api.closeVectorTask).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "note" }, "x"));
    renderWithProviders(<VectorTasks />);
    await openClose("Concluir");
    note("Quarteirões vistoriados na semana");
    fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
    await waitFor(() => expect(screen.getByLabelText("Nota").getAttribute("aria-invalid")).toBe("true"));
    expect((screen.getByLabelText("Nota") as HTMLTextAreaElement).value).toBe("Quarteirões vistoriados na semana");
    await tick();
    expect(api.closeVectorTask).toHaveBeenCalledTimes(1);
    expect(api.listVectorTasks).toHaveBeenCalledTimes(1);
  });

  it("Encerradas: o estado e a data de encerramento, sem Concluir/Dispensar; o cursor é o da aba", async () => {
    vi.mocked(api.listVectorTasks).mockImplementation(async (q) => {
      if (q.state === "open") return page([ INT ], "cur-open");
      return q.before ? page([ DISM1 ]) : page([ DONE1 ], "cur-closed");
    });
    renderWithProviders(<VectorTasks onOpenTransmission={vi.fn()} />);
    await screen.findByRole("list", { name: OPEN });
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await screen.findByRole("list", { name: CLOSED });
    expect(vi.mocked(api.listVectorTasks).mock.calls[1][0]).toEqual({ state: "closed" });
    const closedList = within(screen.getByRole("list", { name: CLOSED }));
    fireEvent.click(within(screen.getByRole("tabpanel", { name: "Encerradas" })).getByRole("button", { name: "Carregar mais" }));
    await closedList.findByText("A92.0");
    expect(vi.mocked(api.listVectorTasks).mock.calls[2][0]).toEqual({ state: "closed", before: "cur-closed" });
    const done = card("OV-07");
    expect(done.getByText("concluída")).not.toBeNull();
    expect(done.getByText("encerrada em 16/11/2026, 08:00")).not.toBeNull();
    expect(card("A92.0").getByText("descartada")).not.toBeNull();
    expect(closedList.queryByRole("button", { name: /Concluir|Dispensar|Abrir o bloqueio/ })).toBeNull();
    expect(api.listVectorTasks).toHaveBeenCalledTimes(3);
  });

  it("listas vazias: as frases", async () => {
    vi.mocked(api.listVectorTasks).mockResolvedValue(page([]));
    renderWithProviders(<VectorTasks />);
    expect(await screen.findByText(OPEN_EMPTY)).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    expect(await screen.findByText(CLOSED_EMPTY)).not.toBeNull();
    expect(api.listVectorTasks).toHaveBeenCalledTimes(2);
  });

  it("laboratório, municipal_admin e o agente: a frase do papel e nenhuma leitura; leitura recusada: a frase do 35a, nunca o código", async () => {
    for (const roles of [ [ "vector_lab" ], [ "municipal_admin" ], [ "health_professional" ] ]) {
      vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser(roles));
      renderWithProviders(<VectorTasks />);
      expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
      await tick();
      expect(api.listVectorTasks).not.toHaveBeenCalled();
      cleanup();
    }
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
    vi.mocked(api.listVectorTasks).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    renderWithProviders(<VectorTasks />);
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(document.body.textContent).not.toContain("missing_role");
    expect(api.listVectorTasks).toHaveBeenCalledTimes(1);
  });
});

describe("nome da doença (Q38)", () => {
  it("o caso de outro município mostra o nome; código sem nome sai cru; uma leitura para todos os cartões", async () => {
    vi.mocked(api.getVectorDiseases).mockResolvedValue(VC_DISEASES);
    renderWithProviders(<VectorTasks />);
    expect(await screen.findByText("Dengue clássico")).not.toBeNull();
    expect(screen.queryByText("A90")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    expect(await screen.findByText("A92.0")).not.toBeNull();
    await tick();
    expect(api.getVectorDiseases).toHaveBeenCalledTimes(1);
  });

  it("a leitura falha: o código cru, sem aviso de erro", async () => {
    vi.mocked(api.getVectorDiseases).mockRejectedValue(new ApiError(500, { error: "internal" }, "x"));
    renderWithProviders(<VectorTasks />);
    expect(await screen.findByText("A90")).not.toBeNull();
    await tick();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.getVectorDiseases).toHaveBeenCalledTimes(1);
  });
});
