import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(), listEndodonticTreatments: vi.fn() }));
import * as api from "../../lib/api";
import type { EndodonticEntry, PeriodontalChart, PeriodontalScreening } from "../../lib/api";
import { PeriodontalScreeningFields } from "./PeriodontalScreeningFields";
import { PeriodontalChartFields } from "./PeriodontalChartFields";
import { EndodonticsFields } from "./EndodonticsFields";
import { renderWithProviders } from "../../test/campaignFixtures";
import { dentalUser } from "../../test/dentalFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
let out: unknown = null;
function Wrap<T>({ init, render: r }: { init: T; render(v: T, set: (v: T) => void): JSX.Element }) {
  const [ v, setV ] = useState(init);
  return r(v, (x) => { out = x; setV(x); });
}

describe("especialidades", () => {
  it("registro periodontal: seis sextantes, X e asterisco", () => {
    render(<Wrap<PeriodontalScreening | null> init={null} render={(v, set) => <PeriodontalScreeningFields value={v} onChange={set} />} />);
    fireEvent.click(screen.getByRole("button", { name: "Preencher o registro periodontal" }));
    fireEvent.change(screen.getByLabelText("Sextante S1"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("S1 com asterisco"));
    fireEvent.change(screen.getByLabelText("Sextante S4"), { target: { value: "X" } });
    expect((out as PeriodontalScreening).sextants.slice(0, 4)).toEqual([ { sextant: "S1", code: 3, star: true }, { sextant: "S2", code: 0, star: false },
      { sextant: "S3", code: 0, star: false }, { sextant: "S4", code: null, star: false } ]);
    fireEvent.click(screen.getByRole("button", { name: "Remover o registro" }));
    expect(out).toBeNull();
  });

  it("periograma: dente a dente, seis sítios rotulados; vazio é nulo; fora da faixa recusa", () => {
    render(<Wrap<PeriodontalChart | null> init={null} render={(v, set) => <PeriodontalChartFields value={v} teeth={[ "16", "26", "36" ]} onChange={set} />} />);
    expect(screen.queryByRole("option", { name: "36" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Dente"), { target: { value: "16" } });
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dente" }));
    fireEvent.change(screen.getByLabelText("Dente 16, sítio MV, profundidade de sondagem (mm)"), { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("Dente 16, sítio MV, sangramento"));
    fireEvent.change(screen.getByLabelText("Dente 16, sítio DL, recessão (mm)"), { target: { value: "-2" } });
    const tooth = (out as PeriodontalChart).teeth[0];
    expect(tooth.sites.find((s) => s.site === "MV")).toEqual({ site: "MV", probing_depth_mm: 5, recession_mm: null, bleeding: true });
    expect(tooth.sites.find((s) => s.site === "DL")?.recession_mm).toBe(-2);
    expect(tooth.sites).toHaveLength(6);
    fireEvent.change(screen.getByLabelText("Dente 16, sítio V, profundidade de sondagem (mm)"), { target: { value: "25" } });
    expect(screen.getByRole("alert").textContent).toContain("dente 16, sítio V: profundidade de sondagem de 0 a 20 mm");
  });

  it("periograma: furca só em molares; mobilidade 0–3 ou vazio", () => {
    render(<Wrap<PeriodontalChart | null> init={null} render={(v, set) => <PeriodontalChartFields value={v} teeth={[ "13", "16" ]} onChange={set} />} />);
    fireEvent.change(screen.getByLabelText("Dente"), { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dente" }));
    fireEvent.change(screen.getByLabelText("Dente"), { target: { value: "16" } });
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dente" }));
    expect(screen.queryByLabelText("Dente 13, furca")).toBeNull();
    fireEvent.change(screen.getByLabelText("Dente 16, furca"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Dente 13, mobilidade"), { target: { value: "1" } });
    const teeth = (out as PeriodontalChart).teeth;
    expect(teeth.find((t) => t.tooth === "16")?.furcation).toBe(2);
    expect(teeth.find((t) => t.tooth === "13")).toMatchObject({ mobility: 1, furcation: null });
    fireEvent.change(screen.getByLabelText("Dente 13, mobilidade"), { target: { value: "" } });
    expect((out as PeriodontalChart).teeth.find((t) => t.tooth === "13")?.mobility).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Remover dente/ })[0]);
    expect((out as PeriodontalChart).teeth).toHaveLength(1);
  });

  it("endodontia: canais e situação; histórico só no clique", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser());
    mocked(api.listEndodonticTreatments).mockResolvedValue([ { tooth: "46", canals: 3, status: "in_progress",
      sessions: [ { consultation_id: "cs0", at: "2026-10-01T09:00:00-03:00", by: { name: "Dra. Lia Moura" } }, { consultation_id: "cs1", at: "2026-10-15T09:00:00-03:00", by: null } ] } ]);
    renderWithProviders(<Wrap<EndodonticEntry[]> init={[]} render={(v, set) => <EndodonticsFields value={v} teeth={[ "46" ]} patientId="pa1" onChange={set} />} />);
    fireEvent.change(screen.getByLabelText("Dente"), { target: { value: "46" } });
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dente" }));
    fireEvent.change(screen.getByLabelText("Dente 46, canais"), { target: { value: "3" } });
    expect(out).toEqual([ { tooth: "46", canals: 3, status: "in_progress" } ]);
    expect(mocked(api.listEndodonticTreatments)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver histórico de endodontia" }));
    expect(await screen.findByText("dente 46 · 3 canais · em andamento · 2 sessões")).not.toBeNull();
    expect(mocked(api.listEndodonticTreatments)).toHaveBeenCalledTimes(1);
  });
});
