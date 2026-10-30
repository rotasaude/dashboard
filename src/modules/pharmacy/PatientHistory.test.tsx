// src/modules/pharmacy/PatientHistory.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  listDispensations: vi.fn(), listMyPharmacyLocations: vi.fn(), recordReturn: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { PatientHistory } from "./PatientHistory";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CLONA, UBS_FARM, dispensation, phUser } from "../../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const REASON = "o paciente trocou de tratamento";

describe("PatientHistory", () => {
  beforeEach(() => {
    for (const fn of [ api.listDispensations, api.recordReturn, api.listMyPharmacyLocations ]) mocked(fn).mockReset();
    window.localStorage.clear(); window.sessionStorage.clear();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.listDispensations).mockResolvedValueOnce({ dispensations: [ dispensation({ retention: { notification_number: null } }) ], next_before: "c1" })
      .mockResolvedValueOnce({ dispensations: [ dispensation({ id: "dp0", at: "2026-09-29T09:00:00-03:00",
        items: [ { ...dispensation().items[0], id: "di0", mapped_from_free_text: true } ] }) ], next_before: null });
  });

  it("lê ao abrir, carrega mais pelo cursor e não relê sozinho", async () => {
    renderWithProviders(<PatientHistory patientId="pa1" />);
    const row = await screen.findByRole("row", { name: /29\/10\/2026/ });
    expect(row.textContent).toContain("Amoxicilina 500 mg cápsula — 21 (lote AMX2611)");
    expect(row.textContent).toContain("Marta Souza · Farmacêutico");
    expect(row.textContent).toContain("receita retida");
    expect(mocked(api.listDispensations)).toHaveBeenCalledWith("pa1", null);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect((await screen.findByRole("row", { name: /29\/09\/2026/ })).textContent).toContain("item da receita em texto livre");
    expect(mocked(api.listDispensations)).toHaveBeenLastCalledWith("pa1", "c1");
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(mocked(api.listDispensations)).toHaveBeenCalledTimes(2));
  });

  it("a marca de retenção aparece, o número da notificação nunca; nada em storage", async () => {
    mocked(api.listDispensations).mockReset();
    mocked(api.listDispensations).mockResolvedValue({ dispensations: [ dispensation({ retention: { notification_number: "B123456" } }) ], next_before: null });
    renderWithProviders(<PatientHistory patientId="pa1" />);
    const row = await screen.findByRole("row", { name: /29\/10\/2026/ });
    expect(row.textContent).toContain("receita retida");
    expect(document.body.textContent).not.toContain("B123456");
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("quem dispensou sem perfil profissional (by.name null): mostra \"—\" e o papel, nunca \"null\"", async () => {
    mocked(api.listDispensations).mockReset();
    mocked(api.listDispensations).mockResolvedValue({ dispensations: [ dispensation({ by: { name: null, role: "pharmacy_assistant" } }) ], next_before: null });
    renderWithProviders(<PatientHistory patientId="pa1" />);
    const row = await screen.findByRole("row", { name: /29\/10\/2026/ });
    expect(row.textContent).toContain("— · Auxiliar de farmácia");
    expect(row.textContent).not.toContain("null");
  });

  it("sem dispensação: frase de vazio; falha da leitura: a frase do api", async () => {
    mocked(api.listDispensations).mockReset();
    mocked(api.listDispensations).mockResolvedValueOnce({ dispensations: [], next_before: null });
    renderWithProviders(<PatientHistory patientId="pa1" />);
    expect(await screen.findByText("nenhuma retirada registrada para este paciente")).not.toBeNull();
    cleanup();
    mocked(api.listDispensations).mockRejectedValueOnce(new ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<PatientHistory patientId="pa1" />);
    expect((await screen.findByRole("alert")).textContent).toBe("seu papel não permite usar a farmácia");
  });

  describe("devolução", () => {
    const openForm = async () => {
      renderWithProviders(<PatientHistory patientId="pa1" />);
      fireEvent.click(await screen.findByRole("button", { name: "Registrar devolução de Amoxicilina 500 mg cápsula" }));
      await screen.findByRole("form", { name: "Registrar devolução" });
    };

    it("o botão só aparece para farmacêutico ou auxiliar do local da dispensação", async () => {
      // Almoxarife do local, e papel de outro local: sem botão. Auxiliar do local: com botão.
      mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ "stock_keeper" ] }, { ...UBS_FARM, id: "l9", roles: [ "pharmacist" ] } ]);
      renderWithProviders(<PatientHistory patientId="pa1" />);
      await screen.findByRole("row", { name: /29\/10\/2026/ });
      expect(screen.queryByRole("button", { name: /Registrar devolução/ })).toBeNull();
      cleanup();
      // Sobra do beforeEach (2 respostas enfileiradas): zera antes de reenfileirar, senão o 2º render leria outra dispensação.
      mocked(api.listDispensations).mockReset();
      mocked(api.listDispensations).mockResolvedValue({ dispensations: [ dispensation() ], next_before: null });
      mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ "pharmacy_assistant" ] } ]);
      renderWithProviders(<PatientHistory patientId="pa1" />);
      expect(await screen.findByRole("button", { name: /Registrar devolução/ })).not.toBeNull();
    });

    it("item controlado: o auxiliar não vê o botão (catálogo ou número retido); no item comum vê; o farmacêutico vê nos dois", async () => {
      const common = dispensation().items[0];
      const mixed = dispensation({ items: [ { ...common, id: "di1" }, { ...common, id: "di2", item: CLONA } ] });
      const byNumber = dispensation({ id: "dp2", retention: { notification_number: "B123456" }, items: [ { ...common, id: "di3" } ] });
      const open = async (role: string, ds = [ mixed ]) => {
        cleanup();
        mocked(api.listDispensations).mockReset();
        mocked(api.listDispensations).mockResolvedValue({ dispensations: ds, next_before: null });
        mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ role ] } ]);
        renderWithProviders(<PatientHistory patientId="pa1" />);
        await screen.findByRole("row", { name: /29\/10\/2026/ });
      };
      expect(CLONA.controlled).toBe(true);
      await open("pharmacy_assistant");
      expect(await screen.findByRole("button", { name: `Registrar devolução de ${common.item.name}` })).not.toBeNull();
      expect(screen.queryByRole("button", { name: `Registrar devolução de ${CLONA.name}` })).toBeNull();
      await open("pharmacy_assistant", [ byNumber ]);
      expect(screen.queryByRole("button", { name: /Registrar devolução/ })).toBeNull();
      await open("pharmacist");
      expect(await screen.findByRole("button", { name: `Registrar devolução de ${common.item.name}` })).not.toBeNull();
      expect(screen.getByRole("button", { name: `Registrar devolução de ${CLONA.name}` })).not.toBeNull();
      await open("pharmacist", [ byNumber ]);
      expect(await screen.findByRole("button", { name: /Registrar devolução/ })).not.toBeNull();
    });

    it("item já devolvido por completo não oferece o botão", async () => {
      mocked(api.listDispensations).mockReset();
      mocked(api.listDispensations).mockResolvedValue({ next_before: null, dispensations: [ dispensation({
        items: [ { ...dispensation().items[0], returned_total: "21.00" } ] }) ] });
      renderWithProviders(<PatientHistory patientId="pa1" />);
      const row = await screen.findByRole("row", { name: /29\/10\/2026/ });
      expect(row.textContent).toContain("devolvido 21");
      expect(screen.queryByRole("button", { name: /Registrar devolução/ })).toBeNull();
    });

    it("limite da quantidade (dispensado − já devolvido) e motivo curto: tudo de uma vez, antes de chamar o api", async () => {
      mocked(api.listDispensations).mockReset();
      mocked(api.listDispensations).mockResolvedValue({ next_before: null, dispensations: [ dispensation({
        items: [ { ...dispensation().items[0], returned_total: "5.00" } ] }) ] });
      await openForm();
      expect(screen.getByText(/até 16/)).not.toBeNull();
      text("Quantidade a devolver", "16,01"); text("Motivo da devolução", "curto");
      fireEvent.click(screen.getByRole("button", { name: "Registrar devolução" }));
      const items = (await screen.findAllByRole("listitem")).map((li) => li.textContent);
      expect(items).toEqual(expect.arrayContaining([ "a quantidade passa do que resta devolver deste item (16)", "o motivo tem de 10 a 500 caracteres" ]));
      // Recusado pela conferência local: o api não é chamado.
      expect(mocked(api.recordReturn)).not.toHaveBeenCalled();
      text("Quantidade a devolver", "1,5,5");
      fireEvent.click(screen.getByRole("button", { name: "Registrar devolução" }));
      expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toContain("a quantidade: use só dígitos e vírgula");
    });

    it("sucesso: corpo com ponto e o item trocado pela dispensação devolvida; sem reler a leitura nominal", async () => {
      mocked(api.recordReturn).mockResolvedValue(dispensation({ retention: { notification_number: null },
        items: [ { ...dispensation().items[0], returned_total: "5.50" } ] }));
      await openForm();
      text("Quantidade a devolver", "5,5"); text("Motivo da devolução", `  ${REASON}  `);
      fireEvent.click(screen.getByRole("button", { name: "Registrar devolução" }));
      await waitFor(() => expect(mocked(api.recordReturn)).toHaveBeenCalledWith({ location_id: "l2", dispensation_item_id: "di1", quantity: "5.5", reason: REASON }));
      expect((await screen.findByRole("status")).textContent).toBe("Devolução registrada.");
      const row = within(screen.getByRole("row", { name: /29\/10\/2026/ }));
      expect(row.getByText("devolvido 5,5")).not.toBeNull();
      expect(screen.queryByRole("form", { name: "Registrar devolução" })).toBeNull();
      expect(mocked(api.listDispensations)).toHaveBeenCalledTimes(1);
    });

    it.each([
      [ "return_exceeds", 422, "a devolução passa do que ainda resta devolver deste item — abra o histórico de novo para ver o atual" ],
      [ "lot_expired", 422, "o lote desta retirada já venceu — a devolução não é aceita; registre o vencimento no ajuste de estoque" ],
      [ "invalid_quantity", 422, "quantidade inválida — use até 2 casas depois da vírgula" ],
      [ "missing_role", 403, "seu papel não permite usar a farmácia" ],
      [ "controlled_requires_pharmacist", 403, "medicamento controlado: só o farmacêutico dispensa" ]
    ])("recusa do api (%s) é mostrada e o que foi digitado fica", async (code, status, phrase) => {
      mocked(api.recordReturn).mockRejectedValue(new ApiError(status, { error: code }, String(status)));
      await openForm();
      text("Quantidade a devolver", "2"); text("Motivo da devolução", REASON);
      fireEvent.click(screen.getByRole("button", { name: "Registrar devolução" }));
      expect((await screen.findByText(phrase)).closest("[role=alert]")).not.toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      // O que foi digitado fica depois da recusa.
      expect((screen.getByLabelText("Quantidade a devolver") as HTMLInputElement).value).toBe("2");
      expect((screen.getByLabelText("Motivo da devolução") as HTMLTextAreaElement).value).toBe(REASON);
      expect(mocked(api.listDispensations)).toHaveBeenCalledTimes(1);
    });

    it("invalid_request com path da quantidade ou do motivo mostra a frase do campo", async () => {
      mocked(api.recordReturn).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "reason" }, "422"));
      await openForm();
      text("Quantidade a devolver", "2"); text("Motivo da devolução", REASON);
      fireEvent.click(screen.getByRole("button", { name: "Registrar devolução" }));
      expect(await screen.findByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    });
  });
});
