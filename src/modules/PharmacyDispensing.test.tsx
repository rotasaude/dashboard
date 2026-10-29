import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), lookupPrescriptions: vi.fn(), lookupPharmacyPerson: vi.fn(), findPharmacyDuplicates: vi.fn(),
  listPositions: vi.fn(), recordDispensation: vi.fn(), listDispensations: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { PharmacyDispensing, REREAD_FAILED_TEXT } from "./PharmacyDispensing";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY27, UBS_FARM, dispensation, phUser, position, prescription, rxItem } from "../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const searchByCode = async (code = "ABCDE23456") => {
  await screen.findByLabelText("Código da receita"); text("Código da receita", code);
  fireEvent.click(screen.getByRole("button", { name: "Buscar receita" }));
};

describe("PharmacyDispensing — busca", () => {
  beforeEach(() => {
    for (const fn of [ api.lookupPrescriptions, api.lookupPharmacyPerson, api.findPharmacyDuplicates ]) mocked(fn).mockReset();
    window.localStorage.clear(); window.sessionStorage.clear();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.lookupPrescriptions).mockResolvedValue([ prescription() ]);
  });

  it("pelo código: normaliza e busca com o local; inválido não chama", async () => {
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    await screen.findByLabelText("Código da receita"); text("Código da receita", "ABC");
    fireEvent.click(screen.getByRole("button", { name: "Buscar receita" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o código da receita tem 10 letras e números (ex.: ABCDE-23456)");
    expect(mocked(api.lookupPrescriptions)).not.toHaveBeenCalled();
    text("Código da receita", "abcde-23456");
    fireEvent.click(screen.getByRole("button", { name: "Buscar receita" }));
    await waitFor(() => expect(mocked(api.lookupPrescriptions)).toHaveBeenCalledWith({ location_id: "l2", short_code: "ABCDE23456" }));
    const card = within(await screen.findByRole("article", { name: /Receita digital/ }));
    expect(card.getByText("Joana Lima")).not.toBeNull();
    expect(card.getByText("emitida em 27/10/2026 · vale até 26/11/2026")).not.toBeNull();
    expect(card.getByText(/1 cápsula de 8 em 8 horas por 7 dias/)).not.toBeNull();
    expect(card.getByRole("button", { name: "Dispensar" })).not.toBeNull();
  });

  it("receita vencida ou cancelada: o motivo no lugar de Dispensar", async () => {
    mocked(api.lookupPrescriptions).mockResolvedValue([ prescription({ expired: true, valid_until: "2026-10-20" }), prescription({ id: "doc2", cancelled: true }) ]);
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    await screen.findByLabelText("Código da receita"); text("Código da receita", "ABCDE23456");
    fireEvent.click(screen.getByRole("button", { name: "Buscar receita" }));
    expect(await screen.findByText("receita vencida em 20/10/2026 — não pode ser dispensada")).not.toBeNull();
    expect(screen.getByText("receita cancelada — não pode ser dispensada")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Dispensar" })).toBeNull();
  });

  it("pelo paciente: CPF pela rota da farmácia; sem paciente, aponta a receita externa", async () => {
    mocked(api.lookupPharmacyPerson).mockResolvedValueOnce({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null, has_cpf: true, cns_masked: null })
      .mockRejectedValueOnce(new ApiError(404, { error: "person_not_found" }, "404"));
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    fireEvent.click(await screen.findByLabelText("Pelo paciente"));
    text("CPF", "123.456.789-09");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Usar Joana Lima" }));
    await waitFor(() => expect(mocked(api.lookupPrescriptions)).toHaveBeenCalledWith({ location_id: "l2", patient_id: "pa1" }));
    expect(mocked(api.lookupPharmacyPerson)).toHaveBeenCalledWith("12345678909");
    fireEvent.click(screen.getByRole("button", { name: "Trocar paciente" }));
    text("CPF", "987.654.321-00");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    expect(await screen.findByText("esta pessoa ainda não tem receita no Rota Saúde — se trouxe receita de fora da rede, use Receita externa")).not.toBeNull();
    expect(mocked(api.lookupPrescriptions)).toHaveBeenCalledTimes(1);
  });

  it("sem local da pessoa: a frase; nada guardado no navegador", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([]);
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    expect(await screen.findByText("você não está vinculado a nenhum local de estoque — peça ao administrador da cidade")).not.toBeNull();
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("código inexistente: a frase do 404, sem cartão", async () => {
    mocked(api.lookupPrescriptions).mockRejectedValue(new ApiError(404, { error: "prescription_not_found" }, "404"));
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    await searchByCode();
    expect((await screen.findByRole("alert")).textContent).toBe("receita não encontrada nesta cidade — confira o código");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("cartão: paciente sem CPF com CNS mascarado, receita externa e vencimento por item", async () => {
    mocked(api.lookupPrescriptions).mockResolvedValue([ prescription({
      kind: "external", id: "ex1", short_code: null, valid_until: "2026-11-26",
      patient: { id: "pa2", display_name: "Pedro Alves", has_cpf: false, cns_masked: "7•••••••••••123" },
      items: [ rxItem({ valid_until: "2026-11-26" }), rxItem({ id: "pi2", printed_description: "Dipirona 500 mg", expired: true, valid_until: "2026-10-25", retention_required: false }) ]
    }) ]);
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    await searchByCode();
    const card = within(await screen.findByRole("article", { name: "Receita externa de 27/10/2026" }));
    expect(card.getByText("sem CPF")).not.toBeNull();
    expect(card.getByText("CNS 7•••••••••••123")).not.toBeNull();
    expect(card.getByText("vale até 26/11/2026", { selector: "span:not([class])" })).not.toBeNull();
    expect(card.getByText("vencido em 25/10/2026")).not.toBeNull();
    expect(card.getAllByText("retém a receita")).toHaveLength(1);
  });

  it("pelo paciente sem CPF: duplicados pela rota da farmácia e a busca pelo paciente escolhido", async () => {
    mocked(api.findPharmacyDuplicates).mockResolvedValue([ { patient_id: "pa9", display_name: "Maria Souza", birth_date: "1980-03-04", has_cpf: false, registration_id: null } ]);
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    fireEvent.click(await screen.findByLabelText("Pelo paciente"));
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    text("Nome completo", "Maria Souza"); text("Data de nascimento", "1980-03-04");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "É esta pessoa" }));
    await waitFor(() => expect(mocked(api.lookupPrescriptions)).toHaveBeenCalledWith({ location_id: "l2", patient_id: "pa9" }));
    expect(mocked(api.findPharmacyDuplicates)).toHaveBeenCalledWith({ full_name: "Maria Souza", birth_date: "1980-03-04" });
    expect(await screen.findByText("Receitas dos últimos 365 dias (até 20).")).not.toBeNull();
  });

  it("CPF de validação pendente: a frase do api", async () => {
    mocked(api.lookupPharmacyPerson).mockRejectedValue(new ApiError(409, { error: "citizen_not_verified" }, "409"));
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    fireEvent.click(await screen.findByLabelText("Pelo paciente"));
    text("CPF", "123.456.789-09");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect((await screen.findByRole("alert")).textContent).toBe("este CPF tem cadastro declarado pelo cidadão, ainda sem validação presencial — valide a identidade antes");
    expect(mocked(api.lookupPrescriptions)).not.toHaveBeenCalled();
  });

  it("trocar de busca tira a lista; sem releitura sozinha", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithProviders(<PharmacyDispensing today={TODAY27} />);
      await searchByCode();
      await screen.findByRole("article", { name: /Receita digital/ });
      vi.advanceTimersByTime(5 * 60_000);
      expect(mocked(api.lookupPrescriptions)).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByLabelText("Pelo paciente"));
      expect(screen.queryByRole("article")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("depois de dispensar: a mesma busca é refeita uma vez e a frase aparece", async () => {
    mocked(api.lookupPrescriptions).mockResolvedValueOnce([ prescription() ])
      .mockResolvedValueOnce([ prescription({ items: [ rxItem({ dispensed_total: "21", completed: true }) ] }) ]);
    renderWithProviders(<PharmacyDispensing today={TODAY27}
      renderDispense={({ onDone }) => <button type="button" onClick={() => onDone()}>Concluir (provisório)</button>} />);
    await searchByCode("abcde-23456");
    fireEvent.click(await screen.findByRole("button", { name: "Dispensar" }));
    fireEvent.click(screen.getByRole("button", { name: "Concluir (provisório)" }));
    expect(await screen.findByText("Dispensação registrada.")).not.toBeNull();
    await screen.findByText("dispensado por completo");
    expect(mocked(api.lookupPrescriptions)).toHaveBeenCalledTimes(2);
    expect(mocked(api.lookupPrescriptions).mock.calls[1][0]).toEqual({ location_id: "l2", short_code: "ABCDE23456" });
    expect(screen.queryByRole("button", { name: "Concluir (provisório)" })).toBeNull();
  });

  it("Dispensar abre o formulário no lugar dos cartões; cancelar volta; o auxiliar usa a tela e o almoxarife não", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacy_assistant" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ "pharmacy_assistant" ] } ]);
    mocked(api.listPositions).mockResolvedValue({ positions: [ position() ], next_before: null });
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    await searchByCode();
    fireEvent.click(await screen.findByRole("button", { name: "Dispensar" }));
    expect(screen.getByRole("button", { name: "Registrar dispensação" })).not.toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Registrar dispensação" })).toBeNull();
    expect(screen.getByRole("article", { name: /Receita digital/ })).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    expect(await screen.findByText("seu papel não permite usar a farmácia")).not.toBeNull();
  });

  it("o formulário real: dispensa, a mesma busca é refeita e a frase aparece", async () => {
    mocked(api.listPositions).mockResolvedValue({ positions: [ position() ], next_before: null });
    mocked(api.recordDispensation).mockResolvedValue(dispensation());
    mocked(api.lookupPrescriptions).mockResolvedValueOnce([ prescription() ])
      .mockResolvedValueOnce([ prescription({ items: [ rxItem({ dispensed_total: "21", completed: true }) ] }) ]);
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    await searchByCode();
    fireEvent.click(await screen.findByRole("button", { name: "Dispensar" }));
    await waitFor(() => expect((screen.getByLabelText("Lote — Amoxicilina 500 mg cápsula") as HTMLSelectElement).value).toBe("lot1"));
    text("Quantidade — Amoxicilina 500 mg cápsula (cápsula)", "21");
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect(await screen.findByText("Dispensação registrada.")).not.toBeNull();
    await screen.findByText("dispensado por completo");
    expect(mocked(api.lookupPrescriptions)).toHaveBeenCalledTimes(2);
  });

  it("receita cancelada no meio: fecha o formulário, tira a lista e deixa a frase", async () => {
    mocked(api.listPositions).mockResolvedValue({ positions: [ position() ], next_before: null });
    mocked(api.recordDispensation).mockRejectedValue(new ApiError(422, { error: "prescription_cancelled" }, "422"));
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    await searchByCode();
    fireEvent.click(await screen.findByRole("button", { name: "Dispensar" }));
    await waitFor(() => expect((screen.getByLabelText("Lote — Amoxicilina 500 mg cápsula") as HTMLSelectElement).value).toBe("lot1"));
    text("Quantidade — Amoxicilina 500 mg cápsula (cápsula)", "21");
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a receita mudou enquanto você dispensava — busque a receita de novo");
    expect(screen.queryByRole("button", { name: "Registrar dispensação" })).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("busca trocada durante o envio: a resposta da dispensação não refaz a busca nem traz o cartão de volta", async () => {
    mocked(api.recordDispensation).mockReset();
    mocked(api.listPositions).mockResolvedValue({ positions: [ position() ], next_before: null });
    let resolve: (d: ReturnType<typeof dispensation>) => void = () => {};
    mocked(api.recordDispensation).mockReturnValue(new Promise((r) => { resolve = r; }));
    renderWithProviders(<PharmacyDispensing today={TODAY27} />);
    await searchByCode();
    fireEvent.click(await screen.findByRole("button", { name: "Dispensar" }));
    await waitFor(() => expect((screen.getByLabelText("Lote — Amoxicilina 500 mg cápsula") as HTMLSelectElement).value).toBe("lot1"));
    text("Quantidade — Amoxicilina 500 mg cápsula (cápsula)", "21");
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    await waitFor(() => expect(mocked(api.recordDispensation)).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText("Pelo paciente"));
    resolve(dispensation());
    expect(await screen.findByText("Dispensação registrada.")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.lookupPrescriptions)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText("relendo a receita…")).toBeNull();
  });

  describe("releitura depois de dispensar", () => {
    const done = ({ onDone }: { onDone(): void }) => <button type="button" onClick={() => onDone()}>Concluir (dublê)</button>;
    const dispenseStub = async () => {
      await searchByCode();
      fireEvent.click(await screen.findByRole("button", { name: "Dispensar" }));
      fireEvent.click(screen.getByRole("button", { name: "Concluir (dublê)" }));
    };

    it("falha: a lista some e a frase explica", async () => {
      mocked(api.lookupPrescriptions).mockResolvedValueOnce([ prescription() ]).mockRejectedValueOnce(new ApiError(500, null, "500"));
      renderWithProviders(<PharmacyDispensing today={TODAY27} renderDispense={done} />);
      await dispenseStub();
      const alertEl = await screen.findByRole("alert");
      expect(alertEl.textContent).toBe(`${REREAD_FAILED_TEXT} (não foi possível concluir (500) — tente de novo)`);
      expect(screen.queryByRole("article")).toBeNull();
      expect(screen.queryByText("Dispensação registrada.")).toBeNull();
    });

    it("enquanto relê, nenhum cartão dispensável; resposta de busca trocada no meio é ignorada", async () => {
      let resolve: (list: ReturnType<typeof prescription>[]) => void = () => {};
      mocked(api.lookupPrescriptions).mockResolvedValueOnce([ prescription() ])
        .mockReturnValueOnce(new Promise((r) => { resolve = r; }));
      renderWithProviders(<PharmacyDispensing today={TODAY27} renderDispense={done} />);
      await dispenseStub();
      expect(await screen.findByText("relendo a receita…")).not.toBeNull();
      expect(screen.queryByRole("article")).toBeNull();
      expect(screen.queryByRole("button", { name: "Dispensar" })).toBeNull();
      fireEvent.click(screen.getByLabelText("Pelo paciente"));
      expect(screen.queryByText("relendo a receita…")).toBeNull();
      resolve([ prescription() ]);
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole("article")).toBeNull();
      expect(screen.queryByText("Dispensação registrada.")).toBeNull();
    });
  });
});
