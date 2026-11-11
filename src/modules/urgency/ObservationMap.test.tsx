// Mapa da observação na mesa da UPA (módulo 32b, F-32.7; api-shapes §3): um cartão por leito, horas desde a 1ª entrada, alerta por
// texto, entrada / troca / saída sem desfecho, polling de 30 s sem timer sobrando e nada clínico.
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()), getUrgencyObservation: vi.fn(), startObservation: vi.fn(), endObservation: vi.fn()
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import type { UrgencyRoles } from "../../lib/urgency";
import { observationBed, observationMap, observedEncounter, stayRef } from "../../test/urgencyObservationFixtures";
import { UPA, patientRef, unidentifiedRef } from "../../test/urgencyFixtures";
import { ObservationMap, type ObservationMapHandle, type ObservationMapProps } from "./ObservationMap";

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  vi.mocked(api.getUrgencyObservation).mockReset();
  vi.mocked(api.startObservation).mockReset();
  vi.mocked(api.endObservation).mockReset();
});

function roles(o: Partial<Pick<UrgencyRoles, "reception" | "nurse" | "doctor" | "technician">>): UrgencyRoles {
  const r = { reception: false, nurse: false, doctor: false, technician: false, ...o };
  return {
    ...r, identify: r.reception, outcomeDesk: r.reception || r.nurse || r.doctor, observation: r.nurse || r.doctor,
    medication: r.nurse || r.technician || r.doctor, mapReader: r.reception || r.nurse || r.technician || r.doctor
  };
}
function mountMap(r: UrgencyRoles, extra: Partial<ObservationMapProps> = {}, ref?: React.Ref<ObservationMapHandle>) {
  return render(<ObservationMap ref={ref} unit={UPA} roles={r} {...extra} />);
}
const calls = () => vi.mocked(api.getUrgencyObservation).mock.calls.length;

describe("ObservationMap", () => {
  it("um cartão por leito: livre ou ocupado com senha, nome, horas e alerta por texto; nada clínico", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ beds: [
      observationBed({ stay: { ...stayRef({ hours: 25, alert: "over_limit" }), complaint: "dor torácica", medication: "morfina" } as never }),
      observationBed({ bed_id: "b2", label: "Obs 2", stay: null })
    ] }));
    mountMap(roles({ nurse: true }));
    const occupied = await screen.findByRole("region", { name: "Obs 1" });
    expect(within(occupied).getByText("U-038 · João Reis")).not.toBeNull();
    expect(within(occupied).getByText("25 h em observação")).not.toBeNull();
    expect(within(occupied).getByText("mais de 24 h em observação")).not.toBeNull();
    expect(within(occupied).getByText(/^Entrada /)).not.toBeNull();
    expect(screen.queryByText(/dor torácica|morfina/)).toBeNull();
    expect(within(screen.getByRole("region", { name: "Obs 2" })).getByText("livre")).not.toBeNull();
  });

  it("alerta perto do limite diz o texto; sem alerta, só as horas", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ beds: [
      observationBed({ stay: stayRef({ hours: 21, alert: "near_limit" }) }),
      observationBed({ bed_id: "b2", label: "Obs 2", stay: stayRef({ stay_id: "st2", encounter_id: "en5", ticket: "U-050", hours: 6, alert: null }) })
    ] }));
    mountMap(roles({ doctor: true }));
    const near = await screen.findByRole("region", { name: "Obs 1" });
    expect(within(near).getByText("perto de 24 h em observação")).not.toBeNull();
    const calm = screen.getByRole("region", { name: "Obs 2" });
    expect(within(calm).getByText("6 h em observação")).not.toBeNull();
    expect(within(calm).queryByText(/perto de|mais de/)).toBeNull();
  });

  it("nome nulo cai no texto de apoio e o provisório diz 'sem identificação'; nunca 'null'", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({
      beds: [
        observationBed({ stay: stayRef({ patient: patientRef({ name: null as never }) }) }),
        observationBed({ bed_id: "b2", label: "Obs 2", stay: stayRef({ stay_id: "st2", encounter_id: "en5", ticket: "U-050", patient: unidentifiedRef() }) })
      ],
      waiting_bed: [ { encounter_id: "en6", ticket: null, patient: patientRef({ name: null as never }), called_at: null } ]
    }));
    mountMap(roles({ doctor: true }));
    const one = await screen.findByRole("region", { name: "Obs 1" });
    expect(within(one).getByText("U-038 · sem nome")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Obs 2" })).getByText("U-050 · sem identificação")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it("entrada: escolhe quem está em atendimento sem leito; uma chamada; relê", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    vi.mocked(api.startObservation).mockResolvedValue(observedEncounter({ id: "en4" }));
    mountMap(roles({ doctor: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
    const select = screen.getByLabelText("Paciente em atendimento");
    expect(within(select).getByRole("option", { name: "U-041 · Rita Melo" })).not.toBeNull();
    fireEvent.change(select, { target: { value: "en4" } });
    const send = screen.getByRole("button", { name: "Confirmar entrada" });
    fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(vi.mocked(api.startObservation).mock.calls).toEqual([ [ "en4", "b2" ] ]));
    expect(await screen.findByText("Paciente em observação.")).not.toBeNull();
    await waitFor(() => expect(calls()).toBe(2));
    expect(screen.queryByLabelText("Paciente em atendimento")).toBeNull();
  });

  it("sem ninguém em atendimento sem leito, a entrada avisa e não envia", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ waiting_bed: [] }));
    mountMap(roles({ nurse: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
    expect(screen.getByText("ninguém em atendimento sem leito")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    expect(vi.mocked(api.startObservation)).not.toHaveBeenCalled();
  });

  it("bed_taken relê o mapa na hora e fecha o formulário", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    vi.mocked(api.startObservation).mockRejectedValue(new ApiError(409, { error: "bed_taken" }, "x"));
    mountMap(roles({ doctor: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
    fireEvent.change(screen.getByLabelText("Paciente em atendimento"), { target: { value: "en4" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    expect(await screen.findByText("outra pessoa ocupou este leito agora — o mapa foi atualizado")).not.toBeNull();
    await waitFor(() => expect(calls()).toBe(2));
    expect(screen.queryByLabelText("Paciente em atendimento")).toBeNull();
  });

  it("outra recusa mantém o formulário aberto com a frase", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    vi.mocked(api.startObservation).mockRejectedValue(new ApiError(403, { error: "cbo_not_allowed" }, "x"));
    mountMap(roles({ doctor: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
    fireEvent.change(screen.getByLabelText("Paciente em atendimento"), { target: { value: "en4" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    expect(await screen.findByText("seu CBO não permite esta etapa na UPA")).not.toBeNull();
    expect(screen.getByLabelText("Paciente em atendimento")).not.toBeNull();
  });

  it("troca só para leito livre e ativo; confirma → startObservation(encontro, novo leito)", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ beds: [
      observationBed(),
      observationBed({ bed_id: "b2", label: "Obs 2", stay: null }),
      observationBed({ bed_id: "b3", label: "Obs 3", active: false, stay: null }),
      observationBed({ bed_id: "b4", label: "Obs 4", stay: stayRef({ stay_id: "st4", encounter_id: "en7", ticket: "U-060" }) })
    ] }));
    vi.mocked(api.startObservation).mockResolvedValue(observedEncounter());
    mountMap(roles({ nurse: true }));
    const card = await screen.findByRole("region", { name: "Obs 1" });
    fireEvent.click(within(card).getByRole("button", { name: "Trocar de leito de U-038" }));
    const select = screen.getByLabelText("Novo leito");
    expect(within(select).getAllByRole("option").map((o) => o.textContent).filter((t) => /Obs/.test(t ?? ""))).toEqual([ "Obs 2" ]);
    fireEvent.change(select, { target: { value: "b2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar troca" }));
    await waitFor(() => expect(vi.mocked(api.startObservation).mock.calls).toEqual([ [ "en3", "b2" ] ]));
    expect(await screen.findByText("Leito trocado.")).not.toBeNull();
  });

  it("encerrar sem desfecho pede confirmação; uma chamada; relê", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    vi.mocked(api.endObservation).mockResolvedValue(observedEncounter());
    mountMap(roles({ doctor: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar observação de U-038" }));
    expect(screen.getByRole("group", { name: "O paciente volta ao atendimento, sem leito. Confirmar?" })).not.toBeNull();
    expect(vi.mocked(api.endObservation)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.endObservation).mock.calls).toEqual([ [ "en3" ] ]));
    expect(await screen.findByText("Observação encerrada.")).not.toBeNull();
    await waitFor(() => expect(calls()).toBe(2));
  });

  it("not_in_observation relê e diz a frase", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    vi.mocked(api.endObservation).mockRejectedValue(new ApiError(422, { error: "not_in_observation" }, "x"));
    mountMap(roles({ nurse: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar observação de U-038" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("este paciente já não está em observação")).not.toBeNull();
    await waitFor(() => expect(calls()).toBe(2));
  });

  it("papéis: recepção só lê; o técnico vê só 'Medicação'; médico escreve e vê 'Medicação'", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    const onMedication = vi.fn();
    const { unmount } = mountMap(roles({ reception: true }), { onMedication });
    await screen.findByRole("region", { name: "Obs 1" });
    expect(screen.queryAllByRole("button").length).toBe(0);
    unmount();

    const tech = mountMap(roles({ technician: true }), { onMedication });
    await screen.findByRole("region", { name: "Obs 1" });
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([ "Medicação de U-038" ]);
    fireEvent.click(screen.getByRole("button", { name: "Medicação de U-038" }));
    expect(onMedication).toHaveBeenCalledWith({ encounterId: "en3", ticket: "U-038", patientName: "João Reis" });
    tech.unmount();

    mountMap(roles({ doctor: true }), { onMedication });
    await screen.findByRole("region", { name: "Obs 1" });
    for (const name of [ "Colocar em observação no Obs 2", "Trocar de leito de U-038", "Encerrar observação de U-038", "Medicação de U-038" ]) {
      expect(screen.getByRole("button", { name })).not.toBeNull();
    }
  });

  it("sem nenhum papel de leitura, não pede", async () => {
    mountMap(roles({}));
    await act(async () => { await Promise.resolve(); });
    expect(calls()).toBe(0);
  });

  it("polling de 30 s, um pedido por vez, nada depois de desmontar", async () => {
    vi.useFakeTimers();
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    const { unmount } = mountMap(roles({ nurse: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls()).toBe(2);
    unmount();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("vínculo perdido (403): para de pedir, diz a frase e 'Tentar de novo' volta a ler", async () => {
    vi.mocked(api.getUrgencyObservation).mockRejectedValue(new ApiError(403, { error: "missing_link" }, "x"));
    mountMap(roles({ technician: true }));
    expect(await screen.findByText("você não tem vínculo com esta unidade")).not.toBeNull();
    expect(screen.getByText(/^parado às /)).not.toBeNull();
    const before = calls();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(calls()).toBe(before + 1));
  });

  it("refresh() pelo ref relê o mapa", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    const ref = createRef<ObservationMapHandle>();
    mountMap(roles({ nurse: true }), {}, ref);
    await screen.findByRole("region", { name: "Obs 1" });
    act(() => ref.current?.refresh());
    await waitFor(() => expect(calls()).toBe(2));
  });

  it("UPA sem leitos: a frase de apoio", async () => {
    vi.mocked(api.getUrgencyObservation).mockResolvedValue({ beds: [], waiting_bed: [] });
    mountMap(roles({ nurse: true }));
    expect(await screen.findByText(/ainda não tem leitos de observação/)).not.toBeNull();
  });

  describe("formulários velhos (fix round 1)", () => {
    const twoBeds = (occupant = stayRef()) => observationMap({ beds: [
      observationBed({ stay: occupant }), observationBed({ bed_id: "b2", label: "Obs 2", stay: null })
    ] });

    it("troca: o leito foi ocupado por outro paciente → o formulário fecha, avisa e nada é enviado", async () => {
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(twoBeds());
      const ref = createRef<ObservationMapHandle>();
      mountMap(roles({ nurse: true }), {}, ref);
      fireEvent.click(await screen.findByRole("button", { name: "Trocar de leito de U-038" }));
      fireEvent.change(screen.getByLabelText("Novo leito"), { target: { value: "b2" } });
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(twoBeds(stayRef({ stay_id: "st9", encounter_id: "en9", ticket: "U-099" })));
      act(() => ref.current?.refresh());
      expect(await screen.findByText("o mapa foi atualizado — confira o leito")).not.toBeNull();
      expect(screen.queryByLabelText("Novo leito")).toBeNull();
      expect(vi.mocked(api.startObservation)).not.toHaveBeenCalled();
    });

    it("entrada: o paciente foi para outro leito → a seleção cai, o formulário segue aberto e nada é enviado", async () => {
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
      const ref = createRef<ObservationMapHandle>();
      mountMap(roles({ doctor: true }), {}, ref);
      fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
      fireEvent.change(screen.getByLabelText("Paciente em atendimento"), { target: { value: "en4" } });
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ waiting_bed: [] }));
      act(() => ref.current?.refresh());
      await waitFor(() => expect(screen.getByText("ninguém em atendimento sem leito")).not.toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
      expect(vi.mocked(api.startObservation)).not.toHaveBeenCalled();
    });

    it("entrada: a seleção cai mas o leito continua livre e há outro na espera", async () => {
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
      const ref = createRef<ObservationMapHandle>();
      mountMap(roles({ doctor: true }), {}, ref);
      fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
      fireEvent.change(screen.getByLabelText("Paciente em atendimento"), { target: { value: "en4" } });
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ waiting_bed: [
        { encounter_id: "en6", ticket: "U-044", patient: patientRef({ patient_id: "pa6", name: "Lia Pires" }), called_at: null } ] }));
      act(() => ref.current?.refresh());
      await waitFor(() => expect((screen.getByLabelText("Paciente em atendimento") as HTMLSelectElement).value).toBe(""));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
      expect(vi.mocked(api.startObservation)).not.toHaveBeenCalled();
    });

    it("entrada: o leito foi ocupado por outro → o formulário fecha e avisa", async () => {
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
      const ref = createRef<ObservationMapHandle>();
      mountMap(roles({ doctor: true }), {}, ref);
      fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ beds: [
        observationBed(), observationBed({ bed_id: "b2", label: "Obs 2", stay: stayRef({ stay_id: "st9", encounter_id: "en9", ticket: "U-099" }) }) ] }));
      act(() => ref.current?.refresh());
      expect(await screen.findByText("o mapa foi atualizado — confira o leito")).not.toBeNull();
      expect(screen.queryByLabelText("Paciente em atendimento")).toBeNull();
    });

    it("o leito sumiu do mapa → o formulário fecha", async () => {
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
      const ref = createRef<ObservationMapHandle>();
      mountMap(roles({ doctor: true }), {}, ref);
      fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ beds: [ observationBed() ] }));
      act(() => ref.current?.refresh());
      await waitFor(() => expect(screen.queryByLabelText("Paciente em atendimento")).toBeNull());
    });

    it("bed_unavailable (422) e invalid_request com path bed_id: frase, relê e fecha", async () => {
      for (const body of [ { error: "bed_unavailable" }, { error: "invalid_request", path: "bed_id" } ]) {
        cleanup();
        vi.mocked(api.getUrgencyObservation).mockReset().mockResolvedValue(observationMap());
        vi.mocked(api.startObservation).mockReset().mockRejectedValue(new ApiError(422, body, "x"));
        mountMap(roles({ doctor: true }));
        fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
        fireEvent.change(screen.getByLabelText("Paciente em atendimento"), { target: { value: "en4" } });
        fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
        expect(await screen.findByText("este leito está inativo ou é de outra unidade — o mapa foi atualizado")).not.toBeNull();
        await waitFor(() => expect(calls()).toBe(2));
        expect(screen.queryByLabelText("Paciente em atendimento")).toBeNull();
      }
    });

    it("leito inativo com estadia aberta fica no grupo 'Leitos inativos', sem entrada", async () => {
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ beds: [
        observationBed({ bed_id: "b3", label: "Obs 3", active: false }) ] }));
      mountMap(roles({ doctor: true }));
      const group = await screen.findByRole("region", { name: "Leitos inativos" });
      expect(within(group).getByRole("region", { name: "Obs 3" })).not.toBeNull();
      expect(within(group).queryByRole("button", { name: /Colocar em observação/ })).toBeNull();
    });

    it("foco: entra no campo ao abrir e volta ao botão ao cancelar", async () => {
      vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
      mountMap(roles({ doctor: true }));
      fireEvent.click(await screen.findByRole("button", { name: "Colocar em observação no Obs 2" }));
      expect(document.activeElement).toBe(screen.getByLabelText("Paciente em atendimento"));
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Colocar em observação no Obs 2" })));
    });
  });

  describe("polling e recusas", () => {
    it("401 e 5xx seguem no intervalo; 403 para e 30 s depois não há nova chamada", async () => {
      vi.useFakeTimers();
      vi.mocked(api.getUrgencyObservation).mockRejectedValueOnce(new ApiError(401, { error: "unauthorized" }, "x"))
        .mockRejectedValueOnce(new ApiError(503, {}, "x")).mockRejectedValueOnce(new ApiError(403, { error: "missing_link" }, "x"))
        .mockResolvedValue(observationMap());
      mountMap(roles({ technician: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(calls()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(calls()).toBe(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(calls()).toBe(3);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls()).toBe(3);
    });
  });
});
