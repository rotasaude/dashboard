import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, cadsusLookup: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { CadsusCheck, matchLabel } from "./CadsusCheck";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderCheck(confirmed = false) {
  const onConfirmedChange = vi.fn();
  render(<CadsusCheck cpf="529.982.247-25" code="123456" confirmed={confirmed} onConfirmedChange={onConfirmedChange} />);
  return onConfirmedChange;
}

describe("CadsusCheck (contratos §5.4)", () => {
  beforeEach(() => m(api.cadsusLookup).mockReset());

  it("matchLabel: confere, diverge, sem dado", () => {
    expect(matchLabel(true)).toBe("confere");
    expect(matchLabel(false)).toBe("diverge do que o cidadão declarou");
    expect(matchLabel(null)).toBe("sem dado para comparar");
  });

  it("encontrado e tudo confere: CNS mascarado e a confirmação é do atendente", async () => {
    m(api.cadsusLookup).mockResolvedValue({ found: true, cns_masked: "7** **** **** 1234", birth_date_matches: true, sex_matches: true });
    const onChange = renderCheck();
    fireEvent.click(screen.getByRole("button", { name: "Consultar CADSUS" }));
    expect(await screen.findByText("7** **** **** 1234")).not.toBeNull();
    expect(api.cadsusLookup).toHaveBeenCalledWith("529.982.247-25", "123456");
    expect(screen.getByText("Data de nascimento: confere")).not.toBeNull();
    expect(screen.getByText("Sexo: confere")).not.toBeNull();
    expect(screen.queryByText(/Há divergência/)).toBeNull();
    const box = screen.getByLabelText("Gravar o CNS do CADSUS no cadastro") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("divergência: aviso, e a confirmação não vem marcada", async () => {
    m(api.cadsusLookup).mockResolvedValue({ found: true, cns_masked: "7** **** **** 1234", birth_date_matches: false, sex_matches: null });
    renderCheck();
    fireEvent.click(screen.getByRole("button", { name: "Consultar CADSUS" }));
    expect(await screen.findByText("Data de nascimento: diverge do que o cidadão declarou")).not.toBeNull();
    expect(screen.getByText("Sexo: sem dado para comparar")).not.toBeNull();
    expect(screen.getByText("Há divergência com o que o cidadão declarou. Confira no documento antes de decidir.")).not.toBeNull();
    expect((screen.getByLabelText("Gravar o CNS do CADSUS no cadastro") as HTMLInputElement).checked).toBe(false);
  });

  it("não encontrado: sem CNS e sem caixa", async () => {
    m(api.cadsusLookup).mockResolvedValue({ found: false, cns_masked: null, birth_date_matches: null, sex_matches: null });
    renderCheck();
    fireEvent.click(screen.getByRole("button", { name: "Consultar CADSUS" }));
    expect(await screen.findByText("Não encontrado no CADSUS. Siga pela conferência do documento.")).not.toBeNull();
    expect(screen.queryByLabelText("Gravar o CNS do CADSUS no cadastro")).toBeNull();
  });

  it("indisponível ou desligado: mensagem e o balcão segue", async () => {
    m(api.cadsusLookup).mockRejectedValueOnce(new ApiError(503, { error: "cadsus_unavailable" }, "503"));
    renderCheck();
    fireEvent.click(screen.getByRole("button", { name: "Consultar CADSUS" }));
    expect(await screen.findByText("CADSUS indisponível agora — siga pela conferência do documento")).not.toBeNull();
    m(api.cadsusLookup).mockRejectedValueOnce(new ApiError(403, { error: "feature_disabled", feature: "cadsus_lookup" }, "403"));
    fireEvent.click(screen.getByRole("button", { name: "Consultar CADSUS" }));
    expect(await screen.findByText("a consulta ao CADSUS foi desligada para a cidade — siga pela conferência do documento")).not.toBeNull();
  });

  it("409 already_verified: mostra a data da verificação", async () => {
    m(api.cadsusLookup).mockRejectedValueOnce(
      new ApiError(409, { error: "already_verified", verified_at: "2026-10-01T13:00:00Z" }, "409"));
    renderCheck();
    fireEvent.click(screen.getByRole("button", { name: "Consultar CADSUS" }));
    expect(await screen.findByText(/^cadastro já verificado em 01\/10\/2026/)).not.toBeNull();
  });
});
