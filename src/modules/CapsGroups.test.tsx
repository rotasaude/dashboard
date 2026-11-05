// Grupos e oficinas (F-31.4): grade semanal sem dado clínico, cadastro e edição do grupo e a lista de presença usável a 375 px — cartões
// empilhados, alvo de 44 px, toque duplo desmarca, envio único, recusa na linha do participante. As frases vêm da lib.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_II, NOW31, OPTIONS, TODAY31, action, enrollmentRow, group, psyUser } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import {
  GROUP_ENDS_TEXT, GROUP_SAVED, NO_GROUPS, PARTICIPANT_NOT_ENROLLED, PRESENCE_NONE, PRESENCE_SAVED, PRESENCE_TODAY_NOTE, PSY_ERRORS, presenceCount
} from "../lib/psychosocial";
import { CapsGroups } from "./CapsGroups";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyOptions: vi.fn(),
  listPsyGroups: vi.fn(), createPsyGroup: vi.fn(), updatePsyGroup: vi.fn(), listPsyEnrollments: vi.fn(), createPsyAction: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// Depois do horário do grupo (quarta, 14h–16h): a presença do dia já pode ser registrada.
const LATE = new Date("2026-11-04T17:00:00-03:00");
const two = (n: number) => String(n).padStart(2, "0");
// Dois homônimos distinguidos pelo CNS mascarado (Pessoa 01 tem CNS; as outras, não).
const PEOPLE = Array.from({ length: 25 }, (_, i) => enrollmentRow({
  id: `en${i + 1}`, patient: { patient_id: `pt${i + 1}`, name: `Pessoa ${two(i + 1)}`, cns_masked: i === 0 ? "*** **** **** 0001" : null }
}));

beforeEach(() => {
  // A grade não leva paciente; a lista de presença, só nome (o api não manda clínico; se mandar, a tela não mostra).
  vi.mocked(api.listPsyGroups).mockResolvedValue([ group() ]);
  vi.mocked(api.listPsyEnrollments).mockResolvedValue(PEOPLE.map((p) => ({ ...p, cid_main: "F322", notes: "segredo" }) as never));
  vi.mocked(api.createPsyAction).mockResolvedValue(action({ group_id: "g1" }));
});

function mount(o: { now?: Date } = {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser());
  vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
  vi.mocked(api.getPsyOptions).mockResolvedValue(OPTIONS);
  return renderWithProviders(<CapsGroups today={TODAY31} now={o.now ?? LATE} />);
}
async function openPresence() {
  fireEvent.click(await screen.findByRole("button", { name: "Registrar presença de Oficina de artes" }));
  return screen.findByRole("button", { name: "Pessoa 01" });
}
const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("Grupos e oficinas", () => {
  it("grade por dia da semana, sem dado clínico", async () => {
    mount();
    expect(await screen.findByText("Oficina de artes")).not.toBeNull();
    expect(screen.getByText("quarta · 14:00–16:00")).not.toBeNull();
    expect(screen.getByText("oficina")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Quarta" })).not.toBeNull();
    // O Hoje também registra presença: a grade avisa.
    expect(screen.getByText(PRESENCE_TODAY_NOTE)).not.toBeNull();
    // O nome do procedimento vem de `options` (o grupo só traz o código).
    expect(screen.getByText(/0301080216 · ATENDIMENTO EM GRUPO/)).not.toBeNull();
    expect(vi.mocked(api.listPsyGroups).mock.calls[0][0]).toBe(CAPS_II.id);
    expect(api.listPsyEnrollments).not.toHaveBeenCalled();
  });

  it("sem grupo: a frase; grupo inativo não oferece presença", async () => {
    vi.mocked(api.listPsyGroups).mockResolvedValue([]);
    mount();
    expect(await screen.findByText(NO_GROUPS)).not.toBeNull();
    cleanup();
    vi.mocked(api.listPsyGroups).mockResolvedValue([ group({ active: false }) ]);
    mount();
    expect(await screen.findByText("inativo")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar presença de Oficina de artes" })).toBeNull();
  });

  it("presença: toque duplo desmarca; duplo clique envia uma vez; recusa na linha do participante", async () => {
    mount();
    await openPresence();
    expect(screen.queryByText(/F32/)).toBeNull();
    expect(screen.queryByText("segredo")).toBeNull();
    const p3 = screen.getByRole("button", { name: "Pessoa 03" });
    fireEvent.click(p3); fireEvent.click(p3);
    expect(p3.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Pessoa 01" }));
    fireEvent.click(screen.getByRole("button", { name: "Pessoa 02" }));
    expect(screen.getByText(presenceCount(2, 25))).not.toBeNull();
    vi.mocked(api.createPsyAction).mockRejectedValueOnce(new ApiError(422, { error: "action_rejected",
      problems: [ { error: "enrollment_required", path: "participants[1]", participant_index: 1 } ] }, "recusa"));
    const send = screen.getByRole("button", { name: "Registrar presença" });
    fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(api.createPsyAction).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.createPsyAction).mock.calls[0][0];
    expect(sent).toMatchObject({ health_unit_id: CAPS_II.id, group_id: "g1", sigtap_code: "0301080216", quantity: 1, place: "caps",
      performed_at: "2026-11-04T14:00:00-03:00" });
    expect(sent.participants).toEqual([ { enrollment_id: "en1" }, { enrollment_id: "en2" } ]);
    expect(await within(screen.getByTestId("presence-en2")).findByText(PARTICIPANT_NOT_ENROLLED)).not.toBeNull();
    expect(within(screen.getByTestId("presence-en1")).queryByText(PARTICIPANT_NOT_ENROLLED)).toBeNull();
    expect(pressed("Pessoa 01")).toBe("true");
    expect(pressed("Pessoa 02")).toBe("true");
    // Desmarcar a pessoa recusada tira a frase dela; o reenvio leva só quem ficou.
    fireEvent.click(screen.getByRole("button", { name: "Pessoa 02" }));
    expect(within(screen.getByTestId("presence-en2")).queryByText(PARTICIPANT_NOT_ENROLLED)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar presença" }));
    expect(await screen.findByText(PRESENCE_SAVED)).not.toBeNull();
    expect(vi.mocked(api.createPsyAction).mock.calls[1][0].participants).toEqual([ { enrollment_id: "en1" } ]);
    // Salvo, a lista fecha e a grade volta.
    expect(screen.queryByRole("button", { name: "Pessoa 01" })).toBeNull();
    expect(screen.getByText("Oficina de artes")).not.toBeNull();
  });

  it("presença em telefone: cartões empilhados, sem tabela, alvo de 44 px; filtro por nome é local", async () => {
    mount();
    const row = await openPresence();
    expect(screen.queryByRole("table")).toBeNull();
    expect(row.style.minHeight).toBe("44px");
    expect(row.style.width).toBe("100%");
    fireEvent.click(row);
    fireEvent.change(screen.getByLabelText("Filtrar por nome"), { target: { value: "pessoa 2" } });
    expect(screen.queryByRole("button", { name: "Pessoa 01" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pessoa 25" })).not.toBeNull();
    // A marcação de quem saiu do filtro continua.
    expect(screen.getByText(presenceCount(1, 25))).not.toBeNull();
    expect(vi.mocked(api.listPsyEnrollments).mock.calls).toEqual([ [ { unitId: CAPS_II.id, status: "open" } ] ]);
  });

  it("presença acima das vagas avisa mas não bloqueia; nenhuma presença não envia", async () => {
    vi.mocked(api.listPsyGroups).mockResolvedValue([ group({ capacity: 1 }) ]);
    mount();
    await openPresence();
    fireEvent.click(screen.getByRole("button", { name: "Registrar presença" }));
    expect(screen.getByText(PRESENCE_NONE)).not.toBeNull();
    expect(api.createPsyAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pessoa 01" }));
    fireEvent.click(screen.getByRole("button", { name: "Pessoa 02" }));
    expect(screen.getByText(presenceCount(2, 1))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar presença" }));
    await waitFor(() => expect(api.createPsyAction).toHaveBeenCalledTimes(1));
  });

  it("antes do horário do grupo é futuro (relógio lido na hora); outra data passada envia", async () => {
    mount({ now: NOW31 });
    await openPresence();
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe(TODAY31);
    fireEvent.click(screen.getByRole("button", { name: "Pessoa 01" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar presença" }));
    expect(screen.getByText(PSY_ERRORS.performed_in_future)).not.toBeNull();
    expect(api.createPsyAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar presença" }));
    await waitFor(() => expect(api.createPsyAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createPsyAction).mock.calls[0][0].performed_at).toBe("2026-10-28T14:00:00-03:00");
  });

  it("nova oficina: o fim antes do começo não envia; completa, envia todos os campos", async () => {
    vi.mocked(api.createPsyGroup).mockResolvedValue(group({ id: "g2", name: "Assembleia", kind: "assembly" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo grupo ou oficina" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Assembleia" } });
    fireEvent.change(screen.getByLabelText("Termina"), { target: { value: "13:00" } });
    fireEvent.change(screen.getByLabelText("Começa"), { target: { value: "14:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar grupo" }));
    expect(screen.getByText(GROUP_ENDS_TEXT)).not.toBeNull();
    expect(api.createPsyGroup).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Termina"), { target: { value: "15:30" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "assembly" } });
    fireEvent.change(screen.getByLabelText("Dia da semana"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Vagas"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080216" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar grupo" }));
    await waitFor(() => expect(api.createPsyGroup).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createPsyGroup).mock.calls[0][0]).toEqual({
      health_unit_id: CAPS_II.id, name: "Assembleia", kind: "assembly", weekday: 5, starts_at: "14:00", ends_at: "15:30", responsible_user_id: "u-1",
      capacity: 40, sigtap_code: "0301080216"
    });
    expect(await screen.findByText(GROUP_SAVED)).not.toBeNull();
    await waitFor(() => expect(api.listPsyGroups).toHaveBeenCalledTimes(2));
  });

  it("editar manda só o que mudou; reativar com a SIGTAP recusada mostra a frase no procedimento", async () => {
    vi.mocked(api.listPsyGroups).mockResolvedValue([ group({ active: false }) ]);
    vi.mocked(api.updatePsyGroup).mockRejectedValueOnce(new ApiError(422, { error: "instrument_mismatch", path: "sigtap_code",
      problems: [ { error: "instrument_mismatch", path: "sigtap_code" } ] }, "recusa"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Editar Oficina de artes" }));
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Oficina de artes");
    fireEvent.click(screen.getByLabelText("Ativo"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar grupo" }));
    await waitFor(() => expect(api.updatePsyGroup).toHaveBeenCalledWith("g1", { active: true }));
    const field = screen.getByLabelText("Procedimento");
    expect(await screen.findByText(PSY_ERRORS.instrument_mismatch)).not.toBeNull();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Oficina de artes");
  });

  it("Enter no filtro ou na data não envia a presença (imutável)", async () => {
    mount();
    await openPresence();
    fireEvent.click(screen.getByRole("button", { name: "Pessoa 01" }));
    for (const label of [ "Filtrar por nome", "Data" ]) {
      // O Enter foi barrado (preventDefault): o <form> não faz a submissão implícita.
      expect(fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" })).toBe(false);
    }
    // Outra tecla segue normal.
    expect(fireEvent.keyDown(screen.getByLabelText("Filtrar por nome"), { key: "a" })).toBe(true);
    expect(api.createPsyAction).not.toHaveBeenCalled();
  });

  it("botão da pessoa: CNS ligado ao nome; borda fixa ao marcar", async () => {
    mount();
    const row = await openPresence();
    const described = (row.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "");
    expect(described).toContain("CNS *** **** **** 0001");
    expect(screen.getByRole("button", { name: "Pessoa 02" }).getAttribute("aria-describedby")).toBeNull();
    const before = row.style.borderWidth;
    fireEvent.click(row);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(row.style.borderWidth).toBe(before);
    expect(before).toBe("2px");
  });

  it("Cancelar devolve o foco ao botão de origem", async () => {
    mount();
    for (const name of [ "Registrar presença de Oficina de artes", "Editar Oficina de artes", "Novo grupo ou oficina" ]) {
      fireEvent.click(await screen.findByRole("button", { name }));
      fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name })));
    }
  });
});
