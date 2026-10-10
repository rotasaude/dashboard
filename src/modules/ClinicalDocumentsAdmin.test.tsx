import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getCityDocumentsProfile: vi.fn(), setCityCnpj: vi.fn(), listRemume: vi.fn(),
    addRemumeItem: vi.fn(), removeRemumeItem: vi.fn(), listActiveUnits: vi.fn(), searchMedications: vi.fn(), listNursingProtocols: vi.fn(),
    createNursingProtocol: vi.fn(), addNursingProtocolVersion: vi.fn() };
});

import * as api from "../lib/api";
import { DOCUMENTS_DISABLED } from "../lib/clinicalDocuments";
import { ClinicalDocumentsAdmin } from "./ClinicalDocumentsAdmin";
import { renderWithProviders } from "../test/campaignFixtures";
import { AMOXICILLIN, CLONAZEPAM, DIPYRONE_REF, NOW19C, docUser, remumeEntry, searchItem } from "../test/documentFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const UNITS = [ { id: "u1", name: "UBS Centro", kind: "ubs" }, { id: "u2", name: "UBS Boqueirão", kind: "ubs" } ];
const admin = () => docUser([ "municipal_admin" ], { id: "ad1", email_address: "admin@curitiba.demo" });

afterEach(() => { cleanup(); vi.useRealTimers(); });

function renderIt() {
  return renderWithProviders(<ClinicalDocumentsAdmin searchDelayMs={0} />);
}

// Promessa que só termina quando o teste manda: segura a requisição "em voo".
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("ClinicalDocumentsAdmin", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19C));
    for (const fn of [ api.fetchCurrentSession, api.getCityDocumentsProfile, api.setCityCnpj, api.listRemume, api.addRemumeItem,
      api.removeRemumeItem, api.listActiveUnits, api.searchMedications, api.listNursingProtocols ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(admin());
    mocked(api.getCityDocumentsProfile).mockResolvedValue({ name: "Curitiba", cnpj: null });
    mocked(api.setCityCnpj).mockResolvedValue({ name: "Curitiba", cnpj: "11222333000181" });
    mocked(api.listRemume).mockResolvedValue([ remumeEntry({ unit_ids: [ "u2" ] }), remumeEntry({ catalog_item: { ...DIPYRONE_REF, antimicrobial: false, controlled: false } }) ]);
    mocked(api.addRemumeItem).mockResolvedValue(remumeEntry());
    mocked(api.removeRemumeItem).mockResolvedValue(undefined);
    mocked(api.listActiveUnits).mockResolvedValue(UNITS);
    mocked(api.searchMedications).mockResolvedValue([ searchItem(), AMOXICILLIN ]);
    mocked(api.listNursingProtocols).mockResolvedValue([]);
  });

  it("só municipal_admin com clinical_documents", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "health_professional" ]));
    const { unmount } = renderIt();
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.listRemume).not.toHaveBeenCalled();
    unmount();
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "municipal_admin" ], { features: [ "clinical_record" ] }));
    renderIt();
    expect(await screen.findByText(DOCUMENTS_DISABLED)).not.toBeNull();
    expect(api.getCityDocumentsProfile).not.toHaveBeenCalled();
  });

  it("CNPJ: sem cadastro diz o efeito; cadastrar com step-up recusa DV inválido e salva só os dígitos", async () => {
    renderIt();
    const panel = await screen.findByRole("region", { name: "CNPJ da cidade" });
    expect(await within(panel).findByText("não cadastrado")).not.toBeNull();
    expect(within(panel).getByText("Sem o CNPJ, a receita de enfermagem não sai (COFEN 801/2026).")).not.toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Cadastrar CNPJ" }));
    const dialog = screen.getByRole("region", { name: "Cadastrar o CNPJ da cidade" });
    fireEvent.change(within(dialog).getByLabelText("CNPJ (14 caracteres)"), { target: { value: "11.222.333/0001-80" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar CNPJ" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("CNPJ inválido — confira os 14 caracteres (números e, no CNPJ novo, letras)");
    expect(api.setCityCnpj).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("CNPJ (14 caracteres)"), { target: { value: "11.222.333/0001-81" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar CNPJ" }));
    await waitFor(() => expect(api.setCityCnpj).toHaveBeenCalledWith("11222333000181"));
    expect((await within(panel).findByRole("status")).textContent).toBe("CNPJ salvo.");
  });

  it("CNPJ: aceita o alfanumérico novo (IN RFB 2.229/2024) e envia sem máscara", async () => {
    renderIt();
    const panel = await screen.findByRole("region", { name: "CNPJ da cidade" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Cadastrar CNPJ" }));
    const dialog = screen.getByRole("region", { name: "Cadastrar o CNPJ da cidade" });
    fireEvent.change(within(dialog).getByLabelText("CNPJ (14 caracteres)"), { target: { value: "12.ABC.345/01DE-35" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar CNPJ" }));
    await waitFor(() => expect(api.setCityCnpj).toHaveBeenCalledWith("12ABC34501DE35"));
  });

  it("CNPJ cadastrado aparece formatado e o botão passa a Trocar", async () => {
    mocked(api.getCityDocumentsProfile).mockResolvedValue({ name: "Curitiba", cnpj: "11222333000181" });
    renderIt();
    const panel = await screen.findByRole("region", { name: "CNPJ da cidade" });
    expect(await within(panel).findByText("11.222.333/0001-81")).not.toBeNull();
    expect(within(panel).getByRole("button", { name: "Trocar CNPJ" })).not.toBeNull();
  });

  it("CNPJ: cidade sem perfil (404) diz e não oferece cadastrar", async () => {
    mocked(api.getCityDocumentsProfile).mockRejectedValue(new api.ApiError(404, { error: "not_found" }, "x"));
    renderIt();
    const panel = await screen.findByRole("region", { name: "CNPJ da cidade" });
    expect(await within(panel).findByText("não cadastrado")).not.toBeNull();
    expect(within(panel).getByText(/a cidade ainda não tem perfil cadastrado/)).not.toBeNull();
    expect(within(panel).queryByRole("button", { name: "Cadastrar CNPJ" })).toBeNull();
    expect(within(panel).queryByRole("alert")).toBeNull();
  });

  it("CNPJ: 422 invalid_cnpj do api tem frase própria", async () => {
    mocked(api.setCityCnpj).mockRejectedValue(new api.ApiError(422, { error: "invalid_cnpj" }, "x"));
    renderIt();
    const panel = await screen.findByRole("region", { name: "CNPJ da cidade" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Cadastrar CNPJ" }));
    const dialog = screen.getByRole("region", { name: "Cadastrar o CNPJ da cidade" });
    fireEvent.change(within(dialog).getByLabelText("CNPJ (14 caracteres)"), { target: { value: "11.222.333/0001-81" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar CNPJ" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("CNPJ inválido — confira os 14 caracteres (números e, no CNPJ novo, letras)");
  });

  it("CNPJ: Salvar trava enquanto a requisição está em voo (duplo clique não manda duas vezes)", async () => {
    const inFlight = deferred<api.CityDocumentsProfile>();
    mocked(api.setCityCnpj).mockReturnValue(inFlight.promise);
    renderIt();
    const panel = await screen.findByRole("region", { name: "CNPJ da cidade" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Cadastrar CNPJ" }));
    const dialog = screen.getByRole("region", { name: "Cadastrar o CNPJ da cidade" });
    fireEvent.change(within(dialog).getByLabelText("CNPJ (14 caracteres)"), { target: { value: "11222333000181" } });
    const save = within(dialog).getByRole("button", { name: "Salvar CNPJ" });
    fireEvent.click(save);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(save);
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect(api.setCityCnpj).toHaveBeenCalledTimes(1);
    inFlight.resolve({ name: "Curitiba", cnpj: "11222333000181" });
    expect((await within(panel).findByRole("status")).textContent).toBe("CNPJ salvo.");
  });

  it("REMUME: lista com as unidades, inclui com a unidade escolhida e tira, com step-up", async () => {
    renderIt();
    const panel = await screen.findByRole("region", { name: "REMUME" });
    const rows = (await within(panel).findAllByRole("row")).slice(1);
    expect(within(rows[0]).getByText("Metformina, cloridrato 850 mg, comprimido")).not.toBeNull();
    expect(await within(rows[0]).findByText("UBS Boqueirão")).not.toBeNull();
    expect(within(rows[1]).getByText("todas")).not.toBeNull();

    fireEvent.change(within(panel).getByLabelText("Incluir na REMUME"), { target: { value: "amox" } });
    fireEvent.click(await within(panel).findByRole("button", { name: "Amoxicilina 500 mg, cápsula" }));
    const add = within(panel).getByRole("region", { name: "Incluir: Amoxicilina 500 mg, cápsula" });
    fireEvent.click(within(add).getByLabelText("UBS Centro"));
    fireEvent.click(within(add).getByRole("button", { name: "Incluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar inclusão" }));
    await waitFor(() => expect(api.addRemumeItem).toHaveBeenCalledWith("ci2", [ "u1" ]));
    expect((await within(panel).findByRole("status")).textContent).toBe("Medicamento incluído na REMUME.");

    fireEvent.click(within(panel).getByRole("button", { name: "Tirar Metformina, cloridrato 850 mg, comprimido da REMUME" }));
    expect(screen.getByText("Ele deixa de aparecer como \"na rede\" na busca da receita; receitas já emitidas não mudam.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar retirada" }));
    await waitFor(() => expect(api.removeRemumeItem).toHaveBeenCalledWith("ci1"));
    await waitFor(() => expect(mocked(api.listRemume).mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it("REMUME: o controlado aparece liberado na busca e pode entrar", async () => {
    mocked(api.searchMedications).mockResolvedValue([ CLONAZEPAM ]);
    renderIt();
    const panel = await screen.findByRole("region", { name: "REMUME" });
    await within(panel).findAllByRole("row");
    fireEvent.change(within(panel).getByLabelText("Incluir na REMUME"), { target: { value: "clon" } });
    const button = await within(panel).findByRole("button", { name: CLONAZEPAM.label });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(within(panel).queryByText("receita de controle especial — 19d")).toBeNull();
    expect(api.searchMedications).toHaveBeenCalledWith("clon", undefined);
  });

  it("REMUME: item que já está na REMUME oferece Trocar unidades, com as atuais marcadas", async () => {
    renderIt();
    const panel = await screen.findByRole("region", { name: "REMUME" });
    await within(panel).findAllByRole("row");
    fireEvent.change(within(panel).getByLabelText("Incluir na REMUME"), { target: { value: "metf" } });
    fireEvent.click(await within(panel).findByRole("button", { name: "Metformina, cloridrato 850 mg, comprimido" }));
    const box = within(panel).getByRole("region", { name: "Incluir: Metformina, cloridrato 850 mg, comprimido" });
    expect(within(box).getByText("este medicamento já está na REMUME — você pode trocar as unidades")).not.toBeNull();
    expect(within(box).queryByRole("button", { name: "Incluir" })).toBeNull();
    expect((within(box).getByLabelText("UBS Boqueirão") as HTMLInputElement).checked).toBe(true);
    expect((within(box).getByLabelText("UBS Centro") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(within(box).getByLabelText("UBS Boqueirão"));
    fireEvent.click(within(box).getByLabelText("UBS Centro"));
    fireEvent.click(within(box).getByRole("button", { name: "Trocar unidades" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar troca" }));
    await waitFor(() => expect(api.addRemumeItem).toHaveBeenCalledWith("ci1", [ "u1" ]));
    expect((await within(panel).findByRole("status")).textContent).toBe("Unidades da REMUME atualizadas.");
  });

  it("REMUME: 422 invalid_catalog_item e invalid_unit têm frase", async () => {
    mocked(api.addRemumeItem).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_catalog_item" }, "x"))
      .mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_unit" }, "x"));
    renderIt();
    const panel = await screen.findByRole("region", { name: "REMUME" });
    await within(panel).findAllByRole("row");
    fireEvent.change(within(panel).getByLabelText("Incluir na REMUME"), { target: { value: "amox" } });
    fireEvent.click(await within(panel).findByRole("button", { name: "Amoxicilina 500 mg, cápsula" }));
    fireEvent.click(within(within(panel).getByRole("region", { name: "Incluir: Amoxicilina 500 mg, cápsula" })).getByRole("button", { name: "Incluir" }));
    const confirm = () => screen.getByRole("region", { name: "Incluir na REMUME: Amoxicilina 500 mg, cápsula" });
    fireEvent.click(within(confirm()).getByRole("button", { name: "Confirmar inclusão" }));
    expect((await within(confirm()).findByRole("alert")).textContent).toBe("este medicamento não está mais ativo no catálogo");
    fireEvent.click(within(confirm()).getByRole("button", { name: "Confirmar inclusão" }));
    await waitFor(() => expect(within(confirm()).getByRole("alert").textContent).toBe("alguma das unidades escolhidas não existe nesta cidade"));
  });

  it("REMUME: Confirmar inclusão trava em voo", async () => {
    const inFlight = deferred<api.RemumeEntry>();
    mocked(api.addRemumeItem).mockReturnValue(inFlight.promise);
    renderIt();
    const panel = await screen.findByRole("region", { name: "REMUME" });
    await within(panel).findAllByRole("row");
    fireEvent.change(within(panel).getByLabelText("Incluir na REMUME"), { target: { value: "amox" } });
    fireEvent.click(await within(panel).findByRole("button", { name: "Amoxicilina 500 mg, cápsula" }));
    fireEvent.click(within(within(panel).getByRole("region", { name: "Incluir: Amoxicilina 500 mg, cápsula" })).getByRole("button", { name: "Incluir" }));
    const confirm = screen.getByRole("button", { name: "Confirmar inclusão" });
    fireEvent.click(confirm);
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(confirm);
    expect(api.addRemumeItem).toHaveBeenCalledTimes(1);
    inFlight.resolve(remumeEntry());
    expect((await within(panel).findByRole("status")).textContent).toBe("Medicamento incluído na REMUME.");
  });

  it("REMUME: Confirmar retirada trava em voo", async () => {
    const inFlight = deferred<undefined>();
    mocked(api.removeRemumeItem).mockReturnValue(inFlight.promise);
    renderIt();
    const panel = await screen.findByRole("region", { name: "REMUME" });
    await within(panel).findAllByRole("row");
    fireEvent.click(within(panel).getByRole("button", { name: "Tirar Metformina, cloridrato 850 mg, comprimido da REMUME" }));
    const confirm = screen.getByRole("button", { name: "Confirmar retirada" });
    fireEvent.click(confirm);
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(confirm);
    expect(api.removeRemumeItem).toHaveBeenCalledTimes(1);
    inFlight.resolve(undefined);
    expect((await within(panel).findByRole("status")).textContent).toBe("Medicamento retirado da REMUME.");
  });

  it("REMUME: sem a lista lida (carregando ou com erro) não dá para escolher item, para não regravar as unidades como \"todas\"", async () => {
    const pending = deferred<api.RemumeEntry[]>();
    mocked(api.listRemume).mockReturnValue(pending.promise);
    const { unmount } = renderIt();
    const panel = await screen.findByRole("region", { name: "REMUME" });
    expect(within(panel).queryByLabelText("Incluir na REMUME")).toBeNull();
    pending.resolve([ remumeEntry({ unit_ids: [ "u2" ] }) ]);
    expect(await within(panel).findByLabelText("Incluir na REMUME")).not.toBeNull();
    unmount();

    mocked(api.listRemume).mockReset();
    mocked(api.listRemume).mockRejectedValue(new api.ApiError(500, { error: "boom" }, "x"));
    renderIt();
    const failed = await screen.findByRole("region", { name: "REMUME" });
    await within(failed).findByRole("alert");
    expect(within(failed).queryByLabelText("Incluir na REMUME")).toBeNull();
    expect(api.addRemumeItem).not.toHaveBeenCalled();
  });

  it("REMUME: Tirar fica travado enquanto há inclusão ou retirada em andamento", async () => {
    renderIt();
    const panel = await screen.findByRole("region", { name: "REMUME" });
    await within(panel).findAllByRole("row");
    const tirar = () => within(panel).getAllByRole("button", { name: /^Tirar / }) as HTMLButtonElement[];
    expect(tirar().every((b) => !b.disabled)).toBe(true);
    fireEvent.click(tirar()[0]);
    expect(tirar().every((b) => b.disabled)).toBe(true);
    fireEvent.click(tirar()[1]);
    expect(screen.getByRole("region", { name: /^Tirar da REMUME: Metformina/ })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(tirar().every((b) => !b.disabled)).toBe(true);
  });

  it("sem autenticador: \"cadastre seu autenticador\" leva à Segurança", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "municipal_admin" ], { mfa_enrolled: false }));
    const goToSecurity = vi.fn();
    renderWithProviders(<ClinicalDocumentsAdmin searchDelayMs={0} onGoToSecurity={goToSecurity} />);
    const panel = await screen.findByRole("region", { name: "CNPJ da cidade" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Cadastrar CNPJ" }));
    fireEvent.click(screen.getByRole("button", { name: "cadastre seu autenticador" }));
    expect(goToSecurity).toHaveBeenCalledTimes(1);
  });

  it("mostra também os protocolos de enfermagem", async () => {
    renderIt();
    expect(await screen.findByRole("region", { name: "Protocolos de enfermagem" })).not.toBeNull();
    expect(await screen.findByText("nenhum protocolo cadastrado")).not.toBeNull();
  });
});
