// src/modules/homeVisits/VisitDetail.vector.test.tsx
// Detalhe da visita com o boletim do agente de endemias (módulo 35a, Task 5; F-35.2, F-35.8): rótulos dos domínios do 35a,
// recuperado, depósitos, medidas com produto e quantidade, amostras com etiqueta e resultado. Sem boletim, nada muda.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getHomeVisit: vi.fn(), getVectorDomains: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { renderWithProviders } from "../../test/campaignFixtures";
import { VISIT_DOMAINS, visit } from "../../test/homeVisitFixtures";
import { VC_DOMAINS, inspection, vcUser } from "../../test/vectorControlFixtures";
import { VisitDetail } from "./VisitDetail";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const SAMPLE = inspection().samples[0];
afterEach(cleanup);
beforeEach(() => {
  for (const f of [ api.fetchCurrentSession, api.getHomeVisit, api.getVectorDomains ]) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser());
  mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
});
const mount = () => renderWithProviders(<VisitDetail id="v1" domains={VISIT_DOMAINS} />);
const coordinator = () => mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
const section = async () => within(await screen.findByRole("region", { name: "Boletim do agente de endemias" }));

describe("Detalhe da visita com boletim", () => {
  it("recuperado, depósitos, medida com produto e quantidade, etiqueta e aguardando resultado (coordenação lê os domínios)", async () => {
    coordinator();
    mocked(api.getHomeVisit).mockResolvedValue(visit({ reasons: [ 34, 35, 37 ], vector_inspection: inspection({
      recovered: true, samples: [ { ...SAMPLE, label: "3F2A9C1E-01" } ] }) }));
    mount();
    const s = await section();
    expect(await s.findByText("LI+T — Levantamento de índice e tratamento")).not.toBeNull();
    expect(s.getByText("Rotina")).not.toBeNull();
    expect(s.getByText("Trabalhado")).not.toBeNull();
    expect(s.getByText("recuperado")).not.toBeNull();
    expect(s.getByText("A2 — Depósito de armazenamento ao nível do solo")).not.toBeNull();
    expect(s.getByText("3 existentes · 2 com água · 1 com larva · 1 eliminados · 1 tratados")).not.toBeNull();
    expect(s.getByText("Pyriproxyfen 0,5% G · 2 cargas · 4,00 g")).not.toBeNull();
    expect(s.getByText("Focal (larvicida)")).not.toBeNull();
    expect(s.getByText("3F2A9C1E-01")).not.toBeNull();
    expect(s.getByText("aguardando resultado")).not.toBeNull();
    expect(s.getByText("12")).not.toBeNull();
    expect(s.getByText("09:40–10:20")).not.toBeNull();
    expect(api.getVectorDomains).toHaveBeenCalledTimes(1);
  });

  it("com resultado: examinadas, aegypti e albopictus; corrigido quando houve correção", async () => {
    mocked(api.getHomeVisit).mockResolvedValue(visit({ vector_inspection: inspection({ samples: [ { ...SAMPLE, label: "3F2A9C1E-01",
      result: { examined_larvae: 8, aegypti_larvae: 5, albopictus_larvae: 1, result_at: "2026-11-17T12:00:00Z", corrected: true } } ] }) }));
    mount();
    const s = await section();
    expect(await s.findByText("examinadas 8 · Ae. aegypti 5 · Ae. albopictus 1")).not.toBeNull();
    expect(s.getByText("corrigido")).not.toBeNull();
    expect(s.queryByText("aguardando resultado")).toBeNull();
  });

  it("mecânica sem produto: o método e nenhuma quantidade", async () => {
    mocked(api.getHomeVisit).mockResolvedValue(visit({ vector_inspection: inspection({
      measures: [ { method: "mechanical", quantity: null, product: null } ], samples: [] }) }));
    mount();
    const s = await section();
    expect(await s.findByText("Mecânico (eliminação)")).not.toBeNull();
    expect(s.getByText("sem amostra")).not.toBeNull();
  });

  it("enfermeiro ou médico da equipe: os rótulos vêm de /vector_control/domains, sem conferir papel antes (Q32)", async () => {
    // A sessão do enfermeiro e a do médico são iguais aqui: health_professional, sem papel do 35a.
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "health_professional" ]));
    mocked(api.getHomeVisit).mockResolvedValue(visit({ vector_inspection: inspection() }));
    mount();
    const s = await section();
    expect(await s.findByText("LI+T — Levantamento de índice e tratamento")).not.toBeNull();
    expect(s.getByText("Trabalhado")).not.toBeNull();
    expect(s.getByText("Rotina")).not.toBeNull();
    expect(s.getByText("A2 — Depósito de armazenamento ao nível do solo")).not.toBeNull();
    expect(s.getByText("Focal (larvicida)")).not.toBeNull();
    expect(api.getVectorDomains).toHaveBeenCalledTimes(1);
  });

  it("/domains falha (403 ou rede): os códigos crus, sem quebrar", async () => {
    for (const err of [ new ApiError(403, { error: "missing_role" }, "x"), new TypeError("Failed to fetch") ]) {
      mocked(api.getVectorDomains).mockReset().mockRejectedValue(err);
      mocked(api.getHomeVisit).mockResolvedValue(visit({ vector_inspection: inspection() }));
      mount();
      const s = await section();
      await waitFor(() => expect(api.getVectorDomains).toHaveBeenCalledTimes(1));
      expect(await s.findByText("li_t")).not.toBeNull();
      expect(s.getByText("worked")).not.toBeNull();
      expect(s.getByText("A2")).not.toBeNull();
      expect(s.getByText("Pyriproxyfen 0,5% G · 2 cargas · 4,00 g")).not.toBeNull();
      cleanup();
    }
  });

  it("visita sem vector_inspection: sem a seção e sem ler os domínios", async () => {
    mocked(api.getHomeVisit).mockResolvedValue(visit());
    mount();
    expect(await screen.findByText("Visita periódica, Pessoa com hipertensão")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Boletim do agente de endemias" })).toBeNull();
    expect(api.getVectorDomains).not.toHaveBeenCalled();
  });
});
