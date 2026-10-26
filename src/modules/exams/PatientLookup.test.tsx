// src/modules/exams/PatientLookup.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PatientLookup } from "./PatientLookup";

afterEach(cleanup);

describe("PatientLookup — documento do paciente (módulo 24a)", () => {
  it("com CPF: a máscara de hoje", () => {
    render(<PatientLookup patient={{ id: "pa1", display_name: "Joana Lima", cpf_masked: "***.982.247-**", has_cpf: true, cns_masked: null }}
      onFound={vi.fn()} />);
    expect(screen.getByText("Paciente: Joana Lima · CPF ***.982.247-**")).not.toBeNull();
  });

  it("sem CPF: 'sem CPF' e o CNS, nunca null", () => {
    render(<PatientLookup patient={{ id: "pa1", display_name: "Joana Lima", cpf_masked: null, has_cpf: false, cns_masked: "*** **** **** 1234" }}
      onFound={vi.fn()} />);
    expect(screen.getByText("Paciente: Joana Lima · sem CPF · CNS *** **** **** 1234")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });
});
