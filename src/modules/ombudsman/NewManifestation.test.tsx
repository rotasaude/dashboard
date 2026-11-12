// Nova manifestação pela equipe (módulo 33; F-33.4; Q22, Q6/Q58, Q60, Q2): tipo, modo, canal, pessoa pelo CPF (busca por POST,
// só par verificado; sem ele, `null` e os campos `manifestant_*`), texto com aviso de texto congelado, anexos `anexo-N.<ext>`
// subidos antes do registro e o comprovante para impressão (só protocolo, tipo, canal, datas; nunca na anônima).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";
import { ombudsmanUser, options, receipt } from "../../test/ombudsmanFixtures";
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { NO_RECEIPT_ANONYMOUS, OMBUDSMAN_ERRORS } from "../../lib/ombudsman";
import { POPUP_BLOCKED } from "../documents/printDocument";
import { OmbudsmanNew } from "../OmbudsmanNew";
import { PERSON_NOT_FOUND } from "./PersonPick";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getOmbudsmanOptions: vi.fn(),
  createOmbudsmanManifestation: vi.fn(), lookupOmbudsmanPerson: vi.fn(), uploadOmbudsmanAttachment: vi.fn(), getOmbudsmanReceipt: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });

const BODY = "Fui à UBS Centro três vezes e não havia losartana.";
const CITIZEN_REFUSED = "este cidadão não pode ser ligado — registre nome e contato na manifestação";

function mount(onOpen: (id: string) => void = vi.fn()) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(ombudsmanUser([ "ombudsman_staff" ]));
  vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
  vi.mocked(api.getOmbudsmanReceipt).mockResolvedValue(receipt());
  return renderWithProviders(<OmbudsmanNew onOpenManifestation={onOpen} />);
}
const KINDS = { complaint: "complaint", request: "request", report: "report" } as const;
async function fillBasics({ kind, channel }: { kind: keyof typeof KINDS; channel: "Presencial" | "Telefone" | "OuvidorSUS" }) {
  fireEvent.change(await screen.findByLabelText("Tipo"), { target: { value: KINDS[kind] } });
  fireEvent.click(screen.getByLabelText(channel));
  fireEvent.change(screen.getByLabelText("Texto da manifestação"), { target: { value: BODY } });
}
async function fillPerson() {
  fireEvent.change(screen.getByLabelText("Nome informado"), { target: { value: "José Alves" } });
}
async function registerSimple() {
  await fillBasics({ kind: "complaint", channel: "Presencial" });
  await fillPerson();
  fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
}
const created = (o: Partial<api.OmbudsmanCreated> = {}) => ({ id: "m9", protocol: "2026-000130", due_on: "2026-12-11", ...o });
const fakeWindow = () => {
  const doc = document.implementation.createHTMLDocument("");
  const win = { document: doc, print: vi.fn(), focus: vi.fn(), close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(win as never);
  return { doc, win };
};
// O comprovante é lido ao aparecer: o botão só imprime com ele em mãos (a janela abre no clique, sem esperar o api).
async function clickPrint() {
  const button = await screen.findByRole("button", { name: "Imprimir comprovante" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}
const sent = () => vi.mocked(api.createOmbudsmanManifestation).mock.calls[0][0];

describe("nova manifestação", () => {
  it("identificada por CPF: busca por POST, citizen_id no corpo, comprovante sem texto nem nome", async () => {
    vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue(created());
    const { doc } = fakeWindow();
    mount();
    vi.mocked(api.lookupOmbudsmanPerson).mockResolvedValue({ citizen_id: "c1", name: "Maria Lima", cpf_masked: "***.***.***-25" });
    fireEvent.change(await screen.findByLabelText("Tipo"), { target: { value: "complaint" } });
    fireEvent.click(screen.getByLabelText("Presencial"));
    fireEvent.change(screen.getByLabelText("CPF de quem manifesta"), { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    expect(vi.mocked(api.lookupOmbudsmanPerson).mock.calls).toEqual([ [ "52998224725" ] ]);
    // Cidadão ligado: nenhum campo manual (o api recusa a mistura).
    expect(screen.queryByLabelText("Nome informado")).toBeNull();
    const body = screen.getByLabelText("Texto da manifestação");
    expectFrozenNotice(body);
    fireEvent.change(body, { target: { value: BODY } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ kind: "complaint", identification_mode: "identified", channel: "in_person", citizen_id: "c1", body: BODY });
    expect(await screen.findByText("2026-000130")).not.toBeNull();
    await clickPrint();
    await waitFor(() => expect(doc.body.textContent).toContain("2026-000130"));
    expect(api.getOmbudsmanReceipt).toHaveBeenCalledWith("m9");
    expect(doc.body.textContent).toMatch(/Reclamação.*Presencial/s);
    expect(doc.body.textContent).not.toMatch(/losartana|Maria|529|\*\*\*/);
    expect(screen.queryByLabelText("CPF de quem manifesta")).toBeNull(); // o formulário foi limpo
    // "Registrar outra" volta a um formulário vazio.
    fireEvent.click(screen.getByRole("button", { name: "Registrar outra" }));
    expect((screen.getByLabelText("CPF de quem manifesta") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Texto da manifestação") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText("Maria Lima")).toBeNull();
  });

  it("pessoa sem par verificado (busca devolve null): nome e contato só na manifestação", async () => {
    vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue(created({ protocol: "2026-000131" }));
    mount();
    vi.mocked(api.lookupOmbudsmanPerson).mockResolvedValue(null);
    await fillBasics({ kind: "request", channel: "Telefone" });
    fireEvent.change(screen.getByLabelText("CPF de quem manifesta"), { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect(await screen.findByText(PERSON_NOT_FOUND)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Nome informado"), { target: { value: "José Alves" } });
    fireEvent.change(screen.getByLabelText("Contato informado"), { target: { value: "(41) 3333-0000" } });
    fireEvent.change(screen.getByLabelText("Texto da manifestação"), { target: { value: BODY } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    await waitFor(() => expect(sent()).toEqual({ kind: "request", identification_mode: "identified",
      channel: "phone", manifestant_name: "José Alves", manifestant_contact: "(41) 3333-0000", manifestant_cpf: "52998224725", body: BODY }));
  });

  it("CPF inválido não sai da tela; a recusa do api na busca também vira a frase do campo", async () => {
    mount();
    vi.mocked(api.lookupOmbudsmanPerson).mockRejectedValue(new ApiError(422, { error: "invalid_cpf", path: "cpf" }, "x"));
    fireEvent.change(await screen.findByLabelText("CPF de quem manifesta"), { target: { value: "111.111.111-11" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.invalid_cpf)).not.toBeNull();
    expect(api.lookupOmbudsmanPerson).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("CPF de quem manifesta"), { target: { value: "529.982.247-25" } });
    expect(screen.queryByText(OMBUDSMAN_ERRORS.invalid_cpf)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.invalid_cpf)).not.toBeNull();
    expect(api.lookupOmbudsmanPerson).toHaveBeenCalledTimes(1);
  });

  it("trocar de lado limpa o outro: o achado apaga o nome digitado; citizen_id recusado (Q60) volta aos campos manuais", async () => {
    vi.mocked(api.createOmbudsmanManifestation)
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "citizen_id" }, "x"))
      .mockResolvedValueOnce(created());
    mount();
    vi.mocked(api.lookupOmbudsmanPerson).mockResolvedValue({ citizen_id: "c1", name: "Maria Lima", cpf_masked: "***.***.***-25" });
    await fillBasics({ kind: "complaint", channel: "Presencial" });
    fireEvent.change(screen.getByLabelText("Nome informado"), { target: { value: "Outra Pessoa" } });
    fireEvent.change(screen.getByLabelText("CPF de quem manifesta"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ kind: "complaint", identification_mode: "identified", channel: "in_person", citizen_id: "c1", body: BODY });
    // Recusado: o cidadão sai, os campos manuais voltam vazios com a frase, e o CPF digitado continua.
    expect(await screen.findByText(CITIZEN_REFUSED)).not.toBeNull();
    expect(screen.queryByText("Maria Lima")).toBeNull();
    expect((screen.getByLabelText("Nome informado") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("CPF de quem manifesta") as HTMLInputElement).value).toBe("529.982.247-25");
    fireEvent.change(screen.getByLabelText("Nome informado"), { target: { value: "Maria Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.createOmbudsmanManifestation).mock.calls[1][0]).toEqual({ kind: "complaint", identification_mode: "identified",
      channel: "in_person", manifestant_name: "Maria Lima", manifestant_cpf: "52998224725", body: BODY });
  });

  it("Trocar devolve a busca vazia, sem o cidadão", async () => {
    mount();
    vi.mocked(api.lookupOmbudsmanPerson).mockResolvedValue({ citizen_id: "c1", name: "Maria Lima", cpf_masked: "***.***.***-25" });
    fireEvent.change(await screen.findByLabelText("CPF de quem manifesta"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trocar" }));
    expect(screen.queryByText("Maria Lima")).toBeNull();
    expect((screen.getByLabelText("CPF de quem manifesta") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("Nome informado")).not.toBeNull();
  });

  it("anônima: só com denúncia, esconde os campos de pessoa e não oferece comprovante", async () => {
    vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue(created({ id: "m10", protocol: "2026-000132" }));
    mount();
    fireEvent.change(await screen.findByLabelText("Tipo"), { target: { value: "complaint" } });
    expect((screen.getByLabelText("Anônima (só denúncia)") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "report" } });
    fireEvent.click(screen.getByLabelText("Anônima (só denúncia)"));
    expect(screen.queryByLabelText("CPF de quem manifesta")).toBeNull();
    expect(screen.queryByLabelText("Nome informado")).toBeNull();
    fireEvent.click(screen.getByLabelText("Telefone"));
    fireEvent.change(screen.getByLabelText("Texto da manifestação"), { target: { value: "Há cobrança indevida por consulta na UBS Centro." } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    expect(await screen.findByText(NO_RECEIPT_ANONYMOUS)).not.toBeNull();
    expect(sent()).toEqual({ kind: "report", identification_mode: "anonymous", channel: "phone",
      body: "Há cobrança indevida por consulta na UBS Centro." });
    expect(screen.queryByRole("button", { name: "Imprimir comprovante" })).toBeNull();
    expect(api.getOmbudsmanReceipt).not.toHaveBeenCalled();
  });

  it("anônima volta a identificada quando o tipo deixa de ser denúncia", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Tipo"), { target: { value: "report" } });
    fireEvent.click(screen.getByLabelText("Anônima (só denúncia)"));
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "praise" } });
    expect((screen.getByLabelText("Identificada") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("CPF de quem manifesta")).not.toBeNull();
  });

  it("OuvidorSUS pede o número; anexos: tipo, tamanho e no máximo 3, enviados antes do registro", async () => {
    vi.mocked(api.uploadOmbudsmanAttachment).mockResolvedValueOnce({ id: "a1" });
    vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue(created({ id: "m11", protocol: "2026-000133" }));
    mount();
    await fillBasics({ kind: "complaint", channel: "OuvidorSUS" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    expect(await screen.findByText("informe o número do OuvidorSUS (até 40 caracteres)")).not.toBeNull();
    expect(api.createOmbudsmanManifestation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Número do OuvidorSUS"), { target: { value: "136-2026-998877" } });
    fireEvent.change(screen.getByLabelText("Anexos"), { target: { files: [ new File([ "x" ], "a.gif", { type: "image/gif" }) ] } });
    expect(screen.getByText(OMBUDSMAN_ERRORS.attachment_type)).not.toBeNull();
    expect(screen.queryByText(/Anexo 1/)).toBeNull();
    const pdf = new File([ "%PDF" ], "laudo-maria.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Anexos"), { target: { files: [ pdf ] } });
    expect(screen.queryByText(OMBUDSMAN_ERRORS.attachment_type)).toBeNull();
    expect(screen.getByText("Anexo 1 (PDF)")).not.toBeNull();
    expect(screen.queryByText(/laudo-maria/)).toBeNull();
    const big = new File([ "x" ], "b.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText("Anexos"), { target: { files: [ big ] } });
    expect(screen.getByText(OMBUDSMAN_ERRORS.attachment_too_large)).not.toBeNull();
    const jpg = () => new File([ "x" ], "c.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Anexos"), { target: { files: [ jpg(), jpg(), jpg() ] } });
    expect(screen.getByText(OMBUDSMAN_ERRORS.attachment_limit)).not.toBeNull();
    expect(screen.queryByText("Anexo 2 (JPEG)")).toBeNull();
    await fillPerson();
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    await waitFor(() => expect(sent())
      .toMatchObject({ channel: "ouvidorsus", ouvidorsus_number: "136-2026-998877", attachment_ids: [ "a1" ] }));
    expect(vi.mocked(api.uploadOmbudsmanAttachment).mock.calls).toEqual([ [ pdf, 1 ] ]);
  });

  it("número do OuvidorSUS com 41 caracteres é recusado, sem cortar o que foi digitado", async () => {
    mount();
    await fillBasics({ kind: "complaint", channel: "OuvidorSUS" });
    await fillPerson();
    const long = "1".repeat(41);
    const input = screen.getByLabelText("Número do OuvidorSUS") as HTMLInputElement;
    fireEvent.change(input, { target: { value: long } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    expect(await screen.findByText("informe o número do OuvidorSUS (até 40 caracteres)")).not.toBeNull();
    expect(api.createOmbudsmanManifestation).not.toHaveBeenCalled();
    expect(input.value).toBe(long);
    expect(input.hasAttribute("maxlength")).toBe(false);
  });

  it("anexo removido não sobe; recusa de um anexo para tudo, sem registrar", async () => {
    vi.mocked(api.uploadOmbudsmanAttachment)
      .mockResolvedValueOnce({ id: "a1" })
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_file" }, "x"));
    mount();
    await fillBasics({ kind: "complaint", channel: "Presencial" });
    await fillPerson();
    const a = new File([ "%PDF" ], "a.pdf", { type: "application/pdf" });
    const b = new File([ "x" ], "b.png", { type: "image/png" });
    const c = new File([ "x" ], "c.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Anexos"), { target: { files: [ a, b, c ] } });
    fireEvent.click(screen.getByRole("button", { name: "Remover anexo 2" }));
    expect(screen.getByText("Anexo 2 (JPEG)")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.invalid_file)).not.toBeNull();
    expect(vi.mocked(api.uploadOmbudsmanAttachment).mock.calls).toEqual([ [ a, 1 ], [ c, 2 ] ]);
    expect(api.createOmbudsmanManifestation).not.toHaveBeenCalled();
  });

  it("canal trocado: o número do OuvidorSUS não vai; unidade referida opcional vai quando escolhida", async () => {
    vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue(created());
    mount();
    await fillBasics({ kind: "complaint", channel: "OuvidorSUS" });
    fireEvent.change(screen.getByLabelText("Número do OuvidorSUS"), { target: { value: "136-2026-998877" } });
    fireEvent.click(screen.getByLabelText("Telefone"));
    expect(screen.queryByLabelText("Número do OuvidorSUS")).toBeNull();
    await screen.findByRole("option", { name: "UBS Centro" });
    fireEvent.change(screen.getByLabelText("Unidade referida (opcional)"), { target: { value: "ubs1" } });
    await fillPerson();
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    await waitFor(() => expect(sent()).toEqual({ kind: "complaint", identification_mode: "identified", channel: "phone",
      manifestant_name: "José Alves", health_unit_id: "ubs1", body: BODY }));
  });

  it("tudo de uma vez: sem tipo, sem canal, sem pessoa e texto curto não registram", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Texto da manifestação"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    expect(await screen.findByText("escolha o tipo")).not.toBeNull();
    expect(screen.getByText("escolha o canal: presencial, telefone ou OuvidorSUS")).not.toBeNull();
    expect(screen.getByText("busque a pessoa pelo CPF ou registre nome e contato")).not.toBeNull();
    expect(screen.getByText("o texto da manifestação tem de ter de 20 a 4000 caracteres")).not.toBeNull();
    expect(api.createOmbudsmanManifestation).not.toHaveBeenCalled();
  });

  it("janela bloqueada: a frase, e nada impresso", async () => {
    vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue(created());
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    mount();
    await registerSimple();
    await clickPrint();
    expect(await screen.findByText(POPUP_BLOCKED)).not.toBeNull();
    expect(open.mock.calls).toEqual([ [ "", "_blank" ] ]);
    // Nada foi impresso: nem a própria tela, nem o comprovante em outra janela.
    expect(print).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Guarde este número");
  });

  it("comprovante não lido: a frase e o botão de ler de novo; relido, imprime", async () => {
    vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue(created());
    const { doc, win } = fakeWindow();
    mount();
    vi.mocked(api.getOmbudsmanReceipt).mockRejectedValueOnce(new ApiError(429, { error: "too_many_requests" }, "x"));
    await registerSimple();
    expect(await screen.findByText(OMBUDSMAN_ERRORS.too_many_requests)).not.toBeNull();
    expect((screen.getByRole("button", { name: "Imprimir comprovante" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ler o comprovante de novo" }));
    await waitFor(() => expect(screen.queryByText(OMBUDSMAN_ERRORS.too_many_requests)).toBeNull());
    expect(screen.queryByRole("button", { name: "Ler o comprovante de novo" })).toBeNull();
    await clickPrint();
    await waitFor(() => expect(doc.body.textContent).toContain("2026-000130"));
    expect(win.print).toHaveBeenCalledTimes(1);
    expect(api.getOmbudsmanReceipt).toHaveBeenCalledTimes(2);
  });

  it("anexo recusado no registro (422 attachment_ids): a nova tentativa sobe o arquivo de novo e manda o id novo", async () => {
    vi.mocked(api.uploadOmbudsmanAttachment).mockResolvedValueOnce({ id: "a1" }).mockResolvedValueOnce({ id: "a2" });
    vi.mocked(api.createOmbudsmanManifestation)
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "attachment_ids" }, "x"))
      .mockResolvedValueOnce(created());
    mount();
    await fillBasics({ kind: "complaint", channel: "Presencial" });
    await fillPerson();
    const pdf = new File([ "%PDF" ], "a.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Anexos"), { target: { files: [ pdf ] } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    expect(await screen.findByText("anexo inválido — suba o arquivo de novo")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar manifestação" }));
    await waitFor(() => expect(api.createOmbudsmanManifestation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.createOmbudsmanManifestation).mock.calls.map((c) => c[0].attachment_ids)).toEqual([ [ "a1" ], [ "a2" ] ]);
    expect(vi.mocked(api.uploadOmbudsmanAttachment).mock.calls).toEqual([ [ pdf, 1 ], [ pdf, 1 ] ]);
  });

  it("Abrir a manifestação leva à Caixa pelo handoff", async () => {
    const onOpen = vi.fn();
    vi.mocked(api.createOmbudsmanManifestation).mockResolvedValue(created());
    mount(onOpen);
    await registerSimple();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir a manifestação" }));
    expect(onOpen).toHaveBeenCalledWith("m9");
  });
});
