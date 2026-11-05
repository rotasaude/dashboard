// Documentos pela ação do CAPS (Task 8; F-31.4, decisão 19): receita, atestado e Notificação de papel pelos formulários do
// 19c/19d com a rota da ação; botão só para o médico autor da ação individual com um matriculado; recusas do CAPS pela frase
// do CAPS; imprimir e cancelar pelas rotas do 19 com a unidade do CAPS; a coordenação também cancela; sem link para o detalhe
// da assinatura. As frases vêm da lib.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CAPS_II, ME_DOCTOR, ME_PSY, NOW31, OPTIONS, TODAY31, action, actionRow, enrollment, psyUser } from "../../test/psychosocialFixtures";
import { prescriptionDoc, sickNoteDoc } from "../../test/documentFixtures";
import { CLONAZEPAM_B1 } from "../../test/controlledFixtures";
import { signatureBlock } from "../../test/signatureFixtures";
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { controlledIssuedNotice } from "../../lib/controlled";
import { fmtDateTime } from "../../lib/format";
import {
  PSY_ACTIONS_KEY, PSY_DETAIL_KEY, PSY_DOCUMENTS_NOTE, PSY_ERRORS, PSY_NOTIFICATION_RECORDED, PSY_NO_DOCUMENTS, psychosocialRoles
} from "../../lib/psychosocial";
import { printDocument } from "../documents/printDocument";
import { ActionDocuments } from "./ActionDocuments";
import { ActionsPanel } from "./ActionsPanel";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyActionDocuments: vi.fn(),
  issuePsyDocument: vi.fn(), issueDocument: vi.fn(), recordNotification: vi.fn(), cancelDocument: vi.fn(), searchMedications: vi.fn(),
  searchTerminology: vi.fn(), getSncrStock: vi.fn(), getProfessionalContact: vi.fn(), getCurrentCertificate: vi.fn(),
  listPsyActions: vi.fn(), getPsyAction: vi.fn() }));
vi.mock("../documents/printDocument", async (orig) => ({ ...(await orig<typeof import("../documents/printDocument")>()), printDocument: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const DOCS = [ "psychosocial_care", "clinical_record", "clinical_documents" ];
const CONTROLLED = [ ...DOCS, "controlled_prescriptions", "digital_signature" ];
const OTHER_DOCTOR = { id: "u-2", name: "Dr. Outro", council: "CRM-PR 1", cbo_code: "225133" };
const capsDoc = (o: Partial<api.ClinicalDocument> = {}) =>
  prescriptionDoc({ id: "d1", author: { id: "u-1", name: ME_DOCTOR.name, council: "CRM-PR 9", cbo_code: "225133" }, consultation_id: null,
    attendance_id: null as never, issued_at: "2026-11-04T09:40:00-03:00", ...o });
const what = (d: api.ClinicalDocument) => `${d.kind === "prescription" ? "Receita" : "Atestado"} de ${fmtDateTime(d.issued_at)}`;

beforeEach(() => {
  vi.mocked(api.listPsyActionDocuments).mockResolvedValue([]);
  vi.mocked(printDocument).mockResolvedValue(null);
});

function mount(o: { action?: api.PsyAction; roles?: string[]; features?: string[] } = {}) {
  const user = psyUser(o.roles ?? [ "psychosocial_staff" ], o.features ?? DOCS);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(
    <ActionDocuments action={o.action ?? action({ professional: ME_DOCTOR })} unit={CAPS_II} roles={psychosocialRoles(user)} today={TODAY31}
      searchDelayMs={0} />
  );
}
const issueGroup = () => screen.queryByRole("group", { name: "emitir documento" });

function fillFreeTextItem() {
  fireEvent.click(screen.getByRole("button", { name: "Incluir em texto livre" }));
  fireEvent.change(screen.getByLabelText("Medicamento 1 (texto livre)"), { target: { value: "Sertralina 50 mg" } });
  fireEvent.change(screen.getByLabelText("Quantidade do item 1"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("Unidade do item 1"), { target: { value: "comprimido" } });
  fireEvent.change(screen.getByLabelText("Via do item 1"), { target: { value: "oral" } });
  fireEvent.change(screen.getByLabelText("Duração em dias do item 1"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("Posologia do item 1"), { target: { value: "1 comprimido pela manhã" } });
}

describe("Documentos da ação do CAPS", () => {
  it("emitir só no próprio atendimento individual de médico com um matriculado", async () => {
    mount({ action: action({ professional: ME_PSY }) });
    expect(await screen.findByText(PSY_NO_DOCUMENTS)).not.toBeNull();
    expect(issueGroup()).toBeNull();
    expect(screen.getByText(PSY_DOCUMENTS_NOTE)).not.toBeNull();
    cleanup();
    const maria = action().participants[0];
    mount({ action: action({ professional: ME_DOCTOR, participants_count: 2, participants: [ maria, { family_name: "Ana Souza" } ] }) });
    expect(await screen.findByText(PSY_NO_DOCUMENTS)).not.toBeNull();
    expect(issueGroup()).toBeNull();
    cleanup();
    mount({ action: action({ professional: { ...ME_DOCTOR, user_id: "u-9" } }) });
    expect(await screen.findByText(PSY_NO_DOCUMENTS)).not.toBeNull();
    expect(issueGroup()).toBeNull();
    cleanup();
    mount({ action: action({ professional: ME_DOCTOR, cancelled: true }) });
    expect(await screen.findByText(PSY_NO_DOCUMENTS)).not.toBeNull();
    expect(issueGroup()).toBeNull();
    cleanup();
    // Sem clinical_documents a emissão some (o api recusaria); a lista continua.
    mount({ features: [ "psychosocial_care", "clinical_record" ] });
    expect(await screen.findByText(PSY_NO_DOCUMENTS)).not.toBeNull();
    expect(issueGroup()).toBeNull();
    cleanup();
    mount();
    const group = await screen.findByRole("group", { name: "emitir documento" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([ "Receita", "Atestado" ]);
    expect(screen.queryByText(PSY_DOCUMENTS_NOTE)).toBeNull();
    cleanup();
    // Com a receita de controlado ligada, também a Notificação de papel.
    mount({ features: CONTROLLED });
    const all = await screen.findByRole("group", { name: "emitir documento" });
    expect(within(all).getAllByRole("button").map((b) => b.textContent)).toEqual([ "Receita", "Atestado", "Notificação (papel)" ]);
  });

  it("receita pelo formulário do 19c com a rota da ação; prescriber_required vira a frase do CAPS e o formulário fica", async () => {
    vi.mocked(api.issuePsyDocument).mockRejectedValueOnce(new ApiError(422, { error: "prescriber_required" }, "x"));
    const { client } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Receita" }));
    fillFreeTextItem();
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    expect(await screen.findByText(PSY_ERRORS.prescriber_required)).not.toBeNull();
    expect(vi.mocked(api.issuePsyDocument).mock.calls[0][0]).toBe("ac1");
    expect(vi.mocked(api.issuePsyDocument).mock.calls[0][1]).toEqual({ kind: "prescription", content: { items: [ {
      free_text: "Sertralina 50 mg", quantity: 30, quantity_unit: "comprimido", route: "oral", dosage_instructions: "1 comprimido pela manhã",
      duration_days: 30, continuous: false } ] } });
    expect(api.issueDocument).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Medicamento 1 (texto livre)") as HTMLInputElement).value).toBe("Sertralina 50 mg");
    // De novo: emite, fecha o formulário, diz e põe na lista.
    const doc = capsDoc();
    vi.mocked(api.issuePsyDocument).mockResolvedValueOnce(doc);
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    expect((await screen.findByRole("status")).textContent).toBe(controlledIssuedNotice(doc));
    expect(screen.queryByRole("form", { name: "Receita" })).toBeNull();
    expect(screen.getByRole("button", { name: `Imprimir ${what(doc)}` })).not.toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: [ PSY_DETAIL_KEY, CAPS_II.id, "action", "ac1", "documents" ] }).length).toBe(1);
  });

  it("not_author pela frase do CAPS; recusa do 19 (catálogo) pela do 19", async () => {
    vi.mocked(api.issuePsyDocument).mockRejectedValueOnce(new ApiError(403, { error: "not_author" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Receita" }));
    fillFreeTextItem();
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    expect(await screen.findByText(PSY_ERRORS.not_author)).not.toBeNull();
  });

  it("ação cancelada noutra aba: already_cancelled fecha o formulário, diz e relê a ação e a lista", async () => {
    vi.mocked(api.issuePsyDocument).mockRejectedValueOnce(new ApiError(409, { error: "already_cancelled" }, "x"));
    const { client } = mount();
    const spy = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Atestado" }));
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    expect((await screen.findByRole("alert")).textContent).toBe(PSY_ERRORS.already_cancelled);
    expect(screen.queryByRole("form", { name: "Atestado" })).toBeNull();
    expect(vi.mocked(api.issuePsyDocument).mock.calls[0]).toEqual([ "ac1", { kind: "sick_note", content: { type: "leave", days: 3, start_on: TODAY31,
      cid_authorized: false } } ]);
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify([ PSY_DETAIL_KEY, CAPS_II.id, "action", "ac1" ]));
    expect(keys).toContain(JSON.stringify([ PSY_ACTIONS_KEY, CAPS_II.id ]));
  });

  it("Notificação de papel pela rota da ação, sem SNCR; a frase não fala da lista de medicamentos", async () => {
    vi.mocked(api.searchMedications).mockResolvedValue([ CLONAZEPAM_B1 ]);
    vi.mocked(api.issuePsyDocument).mockResolvedValue(capsDoc({ kind: "controlled_notification_record", short_code: null }));
    mount({ features: CONTROLLED });
    fireEvent.click(await screen.findByRole("button", { name: "Notificação (papel)" }));
    const form = screen.getByRole("form", { name: "Notificação de papel" });
    fireEvent.change(within(form).getByLabelText("Buscar medicamento (listas A e B)"), { target: { value: "clona" } });
    fireEvent.click(await within(form).findByRole("button", { name: CLONAZEPAM_B1.label }));
    fireEvent.change(within(form).getByLabelText("Número do talão"), { target: { value: "PR0012345" } });
    fireEvent.change(within(form).getByLabelText("Quantidade"), { target: { value: "30" } });
    fireEvent.change(within(form).getByLabelText("Via"), { target: { value: "oral" } });
    fireEvent.change(within(form).getByLabelText("Duração em dias"), { target: { value: "30" } });
    fireEvent.change(within(form).getByLabelText("Posologia"), { target: { value: "1 comprimido à noite" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar Notificação" }));
    expect((await screen.findByRole("status")).textContent).toBe(PSY_NOTIFICATION_RECORDED);
    const [ id, input ] = vi.mocked(api.issuePsyDocument).mock.calls[0];
    expect(id).toBe("ac1");
    expect(input.kind).toBe("controlled_notification_record");
    expect(input.content).toMatchObject({ notification_type: "B", paper_number: "PR0012345", numbering_uf: "PR", item: { catalog_item: { id: "ci3" } } });
    expect(api.recordNotification).not.toHaveBeenCalled();
    // O registro da Notificação não tem impresso.
    expect(screen.queryByRole("button", { name: /^Imprimir/ })).toBeNull();
  });

  it("lista com situação e assinatura, sem link para o detalhe da assinatura; imprimir e cancelar usam a unidade do CAPS", async () => {
    const doc = capsDoc({ signature: signatureBlock() });
    vi.mocked(api.listPsyActionDocuments).mockResolvedValue([ doc ]);
    vi.mocked(api.cancelDocument).mockResolvedValue({ ...doc, status: "cancelled", cancelled_at: "2026-11-04T10:05:00-03:00" });
    mount();
    expect(await screen.findByText("emitido")).not.toBeNull();
    expect(screen.getByText("Receita", { selector: "span" })).not.toBeNull();
    expect(screen.getByText("assinada digitalmente")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Ver o que foi assinado/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Imprimir ${what(doc)}` }));
    await waitFor(() => expect(printDocument).toHaveBeenCalledWith("d1", expect.any(Function), CAPS_II.id));
    fireEvent.click(screen.getByRole("button", { name: `Cancelar ${what(doc)}` }));
    const dialog = screen.getByRole("region", { name: `Cancelar: ${what(doc)}` });
    fireEvent.change(within(dialog).getByLabelText("Motivo do cancelamento"), { target: { value: "receita emitida em duplicidade" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() => expect(api.cancelDocument).toHaveBeenCalledWith("d1", "receita emitida em duplicidade", CAPS_II.id));
    expect(await screen.findByText(`cancelado em ${fmtDateTime("2026-11-04T10:05:00-03:00")}`)).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Documento cancelado.");
  });

  it("a coordenação lotada cancela o documento de outra profissional; a equipe não", async () => {
    vi.mocked(api.listPsyActionDocuments).mockResolvedValue([ sickNoteDoc({ id: "d2", author: OTHER_DOCTOR, issued_at: "2026-11-04T09:40:00-03:00" }) ]);
    const other = action({ professional: { ...ME_DOCTOR, user_id: "u-2" } });
    mount({ action: other });
    const label = `Atestado de ${fmtDateTime("2026-11-04T09:40:00-03:00")}`;
    expect(await screen.findByRole("button", { name: `Imprimir ${label}` })).not.toBeNull();
    expect(screen.queryByRole("button", { name: `Cancelar ${label}` })).toBeNull();
    cleanup();
    mount({ action: other, roles: [ "psychosocial_lead" ] });
    expect(await screen.findByRole("button", { name: `Cancelar ${label}` })).not.toBeNull();
  });

  it("no detalhe da ação, aberto pela lista de ações", async () => {
    vi.mocked(api.listPsyActions).mockResolvedValue({ items: [ actionRow({ professional: ME_DOCTOR }) ], next_before: null });
    vi.mocked(api.getPsyAction).mockResolvedValue(action({ professional: ME_DOCTOR }));
    const user = psyUser([ "psychosocial_staff" ], DOCS);
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
    renderWithProviders(
      <ActionsPanel enrollment={enrollment()} unit={CAPS_II} options={OPTIONS} roles={psychosocialRoles(user)} today={TODAY31} now={NOW31} />
    );
    fireEvent.click(await screen.findByRole("button", { name: `Abrir ação de ${fmtDateTime("2026-11-04T09:00:00-03:00")}` }));
    const section = await screen.findByRole("region", { name: "Documentos da ação" });
    expect(await within(section).findByRole("button", { name: "Receita" })).not.toBeNull();
    expect(vi.mocked(api.listPsyActionDocuments).mock.calls[0][0]).toBe("ac1");
  });
});
