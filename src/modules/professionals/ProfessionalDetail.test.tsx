import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getProfessional: vi.fn(), updateProfessional: vi.fn(),
    listCbo: vi.fn(), listActiveUnits: vi.fn(), openProfessionalLink: vi.fn(), endProfessionalLink: vi.fn(),
    listProfessionalShifts: vi.fn(), scheduleShift: vi.fn(), cancelShift: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { ProfessionalDetail } from "./ProfessionalDetail";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const link = { id: "l1", health_unit_id: "h1", unit_name: "UBS Jardim", cbo_code: "225125", cbo_title: "Médico clínico",
  started_at: "2026-09-01T12:00:00Z", started_by: "admin@c.gov.br", ended_at: null, ended_by: null };
const link2 = { id: "l2", health_unit_id: "h2", unit_name: "UPA Centro", cbo_code: "225124", cbo_title: "Médico pediatra",
  started_at: "2026-09-01T12:00:00Z", started_by: "admin@c.gov.br", ended_at: null, ended_by: null };

function session(stepped: boolean) {
  return { id: "u-admin", email_address: "admin@c.gov.br", operator: false, mfa_enrolled: true,
    mfa_verified_at: stepped ? new Date().toISOString() : null,
    memberships: [ { municipality_id: "m1", municipality_name: "Curitiba", municipality_uf: "PR", role: "municipal_admin" } ] };
}

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<ProfessionalDetail professionalId="p1" onBack={vi.fn()} />, { wrapper });
}

describe("ProfessionalDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-10-05T12:00:00-03:00"));
    mocked(api.fetchCurrentSession).mockResolvedValue(session(true));
    mocked(api.getProfessional).mockResolvedValue({
      professional: { id: "p1", user_id: "u1", email_address: "medica@c.gov.br", professional_name: "Helena Duarte",
        council: "CRM", council_state: "PR", registration_number: "12345", cns_masked: "*** **** **** 0005",
        cns: "700000000000005", phone: null, contact_email: null },
      links: [ link ]
    });
    mocked(api.listCbo).mockResolvedValue([ { code: "225124", title: "Médico pediatra", council: "CRM" } ]);
    mocked(api.listActiveUnits).mockResolvedValue([ { id: "h2", name: "UPA Centro", kind: "upa" } ]);
    mocked(api.listProfessionalShifts).mockResolvedValue([]);
  });

  it("mostra o CNS mascarado, nunca em claro", async () => {
    renderIt();
    expect(await screen.findByText("*** **** **** 0005")).toBeTruthy();
    expect(screen.queryByText("700000000000005")).toBeNull();
  });

  it("abre vínculo pelo SensitiveAction com a janela de step-up aberta", async () => {
    mocked(api.openProfessionalLink).mockResolvedValue({ ...link, id: "l2", health_unit_id: "h2", unit_name: "UPA Centro" });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir vínculo" }));
    // As opções vêm de queries assíncronas — espera-as existirem antes de
    // escolher um valor (setar .value para algo sem <option> correspondente
    // não muda o select, spec HTML).
    await screen.findByRole("option", { name: "UPA Centro" });
    await screen.findByRole("option", { name: "225124 · Médico pediatra" });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "h2" } });
    fireEvent.change(screen.getByLabelText("Ocupação (CBO)"), { target: { value: "225124" } });
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar vínculo" }));
    await waitFor(() => expect(api.openProfessionalLink).toHaveBeenCalledWith("p1", "h2", "225124"));
  });

  it("sem janela: pede código antes de abrir", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session(false));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir vínculo" }));
    await screen.findByRole("option", { name: "UPA Centro" });
    await screen.findByRole("option", { name: "225124 · Médico pediatra" });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "h2" } });
    fireEvent.change(screen.getByLabelText("Ocupação (CBO)"), { target: { value: "225124" } });
    expect(await screen.findByLabelText(/código/i)).toBeTruthy();
  });

  it("mostra erro ao carregar as unidades ativas em vez de deixar o select silenciosamente vazio", async () => {
    mocked(api.listActiveUnits).mockRejectedValue(new Error("falha de rede"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir vínculo" }));
    expect(await screen.findByText("não foi possível concluir — tente de novo")).toBeTruthy();
  });

  it("encerrar avisa quantos turnos futuros nos próximos 62 dias serão cancelados", async () => {
    mocked(api.listProfessionalShifts).mockResolvedValue([
      { id: "s1", professional_link_id: "l1", unit_name: "UBS Jardim", starts_at: "2026-10-06T10:00:00Z",
        ends_at: "2026-10-06T16:00:00Z", cancelled_at: null, cancel_reason: null }
    ]);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    // 62 dias a partir de "hoje" (2026-10-05, fuso da cidade) — não a janela
    // de 14 dias mostrada na tabela de turnos.
    await waitFor(() => expect(api.listProfessionalShifts).toHaveBeenCalledWith("p1", "2026-10-05", "2026-12-06"));
    expect(await screen.findByText(/1 turno futuro nos próximos 62 dias será cancelado/)).toBeTruthy();
  });

  it("mostra quantos turnos foram cancelados depois de confirmar o encerramento", async () => {
    mocked(api.endProfessionalLink).mockResolvedValue({
      link: { ...link, ended_at: "2026-10-05T15:00:00Z", ended_by: "admin@c.gov.br" },
      cancelled_shift_ids: [ "s1", "s2" ]
    });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar encerramento" }));
    expect(await screen.findByText(/Vínculo encerrado; 2 turnos cancelados/)).toBeTruthy();
    expect(api.endProfessionalLink).toHaveBeenCalledWith("l1");
  });

  it("pagina uma semana adiante e refaz a consulta de turnos", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "semana →" }));
    await waitFor(() => expect(api.listProfessionalShifts).toHaveBeenCalledWith("p1", "2026-10-12", "2026-10-26"));
  });

  it("cancelar turno exige motivo e envia o motivo digitado", async () => {
    mocked(api.listProfessionalShifts).mockResolvedValue([
      { id: "s1", professional_link_id: "l1", unit_name: "UBS Jardim", starts_at: "2026-10-06T10:00:00Z",
        ends_at: "2026-10-06T16:00:00Z", cancelled_at: null, cancel_reason: null }
    ]);
    mocked(api.cancelShift).mockResolvedValue({} as api.ProfessionalShift);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    const confirmBtn = screen.getByRole("button", { name: "Confirmar cancelamento" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "erro de lançamento" } });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(api.cancelShift).toHaveBeenCalledWith("s1", "erro de lançamento"));
  });

  it("lança plantão noturno mostrando o dia seguinte e envia os dois instantes", async () => {
    mocked(api.scheduleShift).mockResolvedValue({} as api.ProfessionalShift);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Lançar turno" }));
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-06" } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "07:00" } });
    expect(screen.getByText("termina em 07/10 às 07:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar turno" }));
    await waitFor(() => expect(api.scheduleShift).toHaveBeenCalledWith("l1", "2026-10-06T19:00:00-03:00", "2026-10-07T07:00:00-03:00"));
  });

  it("sobreposição aparece nomeando o turno em conflito", async () => {
    mocked(api.scheduleShift).mockRejectedValue(new ApiError(409, { error: "shift_overlap",
      conflict: { unit_name: "UPA Centro", starts_at: "2026-10-06T22:00:00Z", ends_at: "2026-10-07T10:00:00Z" } }, "x"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Lançar turno" }));
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-06" } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "07:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar turno" }));
    expect(await screen.findByText("conflita com o turno em UPA Centro, 06/10 19:00–07:00")).toBeTruthy();
  });

  it("depois de 'Salvar turno' mostra a linha 'turno lançado' com data e horas", async () => {
    mocked(api.scheduleShift).mockResolvedValue({} as api.ProfessionalShift);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Lançar turno" }));
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-06" } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "07:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar turno" }));
    expect(await screen.findByText("turno lançado: 06/10 19:00–07:00")).toBeTruthy();
    // O painel de lançamento continua na tela (com "Fechar") até a pessoa
    // fechar — não deveria simplesmente sumir levando a confirmação junto.
    expect(screen.getByRole("button", { name: "Fechar" })).toBeTruthy();
  });

  it("'Lançar turno' noutro vínculo depois de salvar mostra o formulário novo, não a confirmação antiga", async () => {
    mocked(api.getProfessional).mockResolvedValue({
      professional: { id: "p1", user_id: "u1", email_address: "medica@c.gov.br", professional_name: "Helena Duarte",
        council: "CRM", council_state: "PR", registration_number: "12345", cns_masked: "*** **** **** 0005",
        cns: "700000000000005", phone: null, contact_email: null },
      links: [ link, link2 ]
    });
    mocked(api.scheduleShift).mockResolvedValue({} as api.ProfessionalShift);
    renderIt();
    const openButtons = await screen.findAllByRole("button", { name: "Lançar turno" });
    fireEvent.click(openButtons[0]);
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-06" } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "07:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar turno" }));
    expect(await screen.findByText("turno lançado: 06/10 19:00–07:00")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Lançar turno" })[1]);
    expect(await screen.findByText("Turno em UPA Centro")).toBeTruthy();
    expect(screen.queryByText("turno lançado: 06/10 19:00–07:00")).toBeNull();
    expect(screen.getByLabelText("Data")).toBeTruthy();
  });

  it("'Lançar turno' de novo no mesmo vínculo depois de salvar reabre um formulário limpo", async () => {
    mocked(api.scheduleShift).mockResolvedValue({} as api.ProfessionalShift);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Lançar turno" }));
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-06" } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "07:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar turno" }));
    expect(await screen.findByText("turno lançado: 06/10 19:00–07:00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Lançar turno" }));
    expect(screen.queryByText("turno lançado: 06/10 19:00–07:00")).toBeNull();
    expect(await screen.findByLabelText("Data")).toBeTruthy();
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe("");
  });

  describe("prévia de turnos futuros ao encerrar (EndLink)", () => {
    it("mostra 'contando turnos futuros…' enquanto a consulta carrega, nunca 'nenhum turno'", async () => {
      renderIt();
      // O one-shot precisa mirar a consulta do EndLink (disparada só ao
      // clicar em "Encerrar"), não a da tabela de Turnos (disparada no mount
      // do componente, antes daqui) — senão o teste passaria mesmo que a
      // prévia mostrasse "Nenhum turno futuro" direto, já que o mock base
      // (`mockResolvedValue([])` do beforeEach) resolveria essa consulta.
      const endButton = await screen.findByRole("button", { name: "Encerrar" });
      let resolveShifts: (rows: api.ProfessionalShift[]) => void = () => {};
      mocked(api.listProfessionalShifts).mockReturnValueOnce(new Promise((resolve) => { resolveShifts = resolve; }));
      fireEvent.click(endButton);
      expect(await screen.findByText("contando turnos futuros…")).toBeTruthy();
      expect(screen.queryByText(/Nenhum turno futuro/)).toBeNull();
      resolveShifts([]);
      expect(await screen.findByText(/Nenhum turno futuro nos próximos 62 dias será cancelado/)).toBeTruthy();
    });

    it("mostra o erro traduzido quando a contagem falha, nunca 'nenhum turno'", async () => {
      renderIt();
      // Mesmo cuidado: mira a consulta do EndLink, disparada só depois do
      // clique — não a da tabela de Turnos, já disparada no mount.
      const endButton = await screen.findByRole("button", { name: "Encerrar" });
      mocked(api.listProfessionalShifts).mockRejectedValueOnce(new ApiError(500, "", "x"));
      fireEvent.click(endButton);
      expect(await screen.findByText("não foi possível concluir — tente de novo")).toBeTruthy();
      expect(screen.queryByText(/Nenhum turno futuro/)).toBeNull();
    });

    it("lançar um turno (refresh) atualiza a prévia, porque ela vive sob o mesmo prefixo que refresh() invalida", async () => {
      mocked(api.listProfessionalShifts).mockResolvedValue([]);
      renderIt();
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      expect(await screen.findByText(/Nenhum turno futuro nos próximos 62 dias será cancelado/)).toBeTruthy();

      // Com o painel de Encerrar ainda aberto, lança um turno futuro nesse
      // vínculo — refresh() (chamado por onSaved) invalida o prefixo
      // "professionalShifts" inteiro, o que deve refazer também a consulta
      // desta prévia (mesma chave aninhada nesse prefixo).
      mocked(api.listProfessionalShifts).mockResolvedValue([
        { id: "s2", professional_link_id: "l1", unit_name: "UBS Jardim", starts_at: "2026-10-06T10:00:00Z",
          ends_at: "2026-10-06T16:00:00Z", cancelled_at: null, cancel_reason: null }
      ]);
      mocked(api.scheduleShift).mockResolvedValue({} as api.ProfessionalShift);
      fireEvent.click(await screen.findByRole("button", { name: "Lançar turno" }));
      fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-06" } });
      fireEvent.change(screen.getByLabelText("Início"), { target: { value: "10:00" } });
      fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "16:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar turno" }));
      await screen.findByText("turno lançado: 06/10 10:00–16:00");

      expect(await screen.findByText(/1 turno futuro nos próximos 62 dias será cancelado/)).toBeTruthy();
    });
  });

  describe("OpenLink: buscar ocupação pode tirar a escolhida da lista", () => {
    it("filtrar e tirar a ocupação escolhida limpa 'code' e esconde a confirmação", async () => {
      renderIt();
      fireEvent.click(await screen.findByRole("button", { name: "Abrir vínculo" }));
      await screen.findByRole("option", { name: "UPA Centro" });
      await screen.findByRole("option", { name: "225124 · Médico pediatra" });
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "h2" } });
      fireEvent.change(screen.getByLabelText("Ocupação (CBO)"), { target: { value: "225124" } });
      expect(await screen.findByRole("button", { name: "Confirmar vínculo" })).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Buscar ocupação"), { target: { value: "nada-bate-com-isto" } });
      expect(screen.queryByRole("button", { name: "Confirmar vínculo" })).toBeNull();
      expect((screen.getByLabelText("Ocupação (CBO)") as HTMLSelectElement).value).toBe("");
    });

    it("a descrição da confirmação nomeia unidade, código e ocupação escolhidos", async () => {
      renderIt();
      fireEvent.click(await screen.findByRole("button", { name: "Abrir vínculo" }));
      await screen.findByRole("option", { name: "UPA Centro" });
      await screen.findByRole("option", { name: "225124 · Médico pediatra" });
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "h2" } });
      fireEvent.change(screen.getByLabelText("Ocupação (CBO)"), { target: { value: "225124" } });
      expect(await screen.findByText(
        "UPA Centro · 225124 · Médico pediatra — com o vínculo, o profissional passa a chamar e registrar desfecho nesta unidade."
      )).toBeTruthy();
    });
  });

  it("falha ao ler os turnos mostra a mensagem de erro, não 'nenhum turno no período'", async () => {
    mocked(api.listProfessionalShifts).mockRejectedValue(new ApiError(500, "", "x"));
    renderIt();
    expect(await screen.findByText("não foi possível concluir — tente de novo")).toBeTruthy();
    expect(screen.queryByText("nenhum turno no período")).toBeNull();
  });

  it("a tabela de turnos mostra a Ocupação do vínculo do turno", async () => {
    mocked(api.listProfessionalShifts).mockResolvedValue([
      { id: "s1", professional_link_id: "l1", unit_name: "UBS Jardim", starts_at: "2026-10-06T10:00:00Z",
        ends_at: "2026-10-06T16:00:00Z", cancelled_at: null, cancel_reason: null }
    ]);
    renderIt();
    // "Ocupação" e "225125 · Médico clínico" já aparecem uma vez na tabela de
    // Vínculos (mesmo profissional, mesmo vínculo) — a tabela de Turnos soma
    // uma segunda ocorrência de cada.
    expect(await screen.findAllByText("Ocupação")).toHaveLength(2);
    expect(await screen.findAllByText("225125 · Médico clínico")).toHaveLength(2);
  });
});
