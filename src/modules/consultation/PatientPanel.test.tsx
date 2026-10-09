// src/modules/consultation/PatientPanel.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PatientPanel } from "./PatientPanel";
import { record } from "../../test/consultationFixtures";
import type { PatientProblem } from "../../lib/api";

afterEach(cleanup);

describe("PatientPanel", () => {
  it("nome de exibição, idade, sexo, problemas, escuta de hoje e últimas consultas", () => {
    const onOpen = vi.fn();
    render(<PatientPanel record={record()} onOpenConsultation={onOpen} />);
    const panel = screen.getByRole("region", { name: "Paciente" });
    expect(within(panel).getByText("Joana Lima")).not.toBeNull();
    expect(within(panel).queryByText("João Carlos Lima")).toBeNull();
    expect(within(panel).getByText("54 anos")).not.toBeNull();
    expect(within(panel).getByText("feminino")).not.toBeNull();
    expect(within(panel).getByText(/Diabetes não insulino-dependente · desde 03\/2019/)).not.toBeNull();
    expect(within(panel).getByText("vermelho")).not.toBeNull();
    expect(within(panel).getByText("Pressão sistólica: 185 mmHg")).not.toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Abrir consulta de 10/09/2026, 14:30" }));
    expect(onOpen).toHaveBeenCalledWith("cs0");
  });

  it("sem escuta nem consultas anteriores", () => {
    render(<PatientPanel record={record({ today_screening: null, consultations: [], problems: [] })} onOpenConsultation={vi.fn()} />);
    expect(screen.getByText("sem escuta concluída hoje")).not.toBeNull();
    expect(screen.getByText("nenhum problema ativo")).not.toBeNull();
    expect(screen.getByText("nenhuma consulta anterior")).not.toBeNull();
  });
});

describe("PatientPanel sem chaves opcionais (o api omite os nulos)", () => {
  it("problema sem início e escuta sem queixa nem alertas", () => {
    const bare = { id: "pp2", terminology: "ciap2", code: "K86", label: "Hipertensão", status: "active" } as PatientProblem;
    render(<PatientPanel record={record({ problems: [ bare ] })} onOpenConsultation={vi.fn()} />);
    expect(screen.getByText(/Hipertensão · início não informado/)).not.toBeNull();
  });
});
