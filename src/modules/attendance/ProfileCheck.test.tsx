import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfileCheck, initialProfileCheck, profileCheckProblem } from "./ProfileCheck";

afterEach(cleanup);
const TODAY = "2026-10-05";
const DECLARED = { birth_date: "1963-04-02", sex: "female" as const, gender_identity: "cis_woman" as const, profile_source: "declared" as const };

describe("ProfileCheck", () => {
  it("valor inicial vem do declarado; sem perfil, tudo vazio", () => {
    expect(initialProfileCheck(DECLARED)).toEqual({ birthDate: "1963-04-02", sex: "female", genderIdentity: "cis_woman" });
    expect(initialProfileCheck(null)).toEqual({ birthDate: "", sex: "", genderIdentity: "" });
  });

  it("problema: data primeiro, depois sexo; identidade é opcional", () => {
    expect(profileCheckProblem({ birthDate: "", sex: "", genderIdentity: "" }, TODAY)).toBe("informe a data de nascimento");
    expect(profileCheckProblem({ birthDate: "1990-01-01", sex: "", genderIdentity: "" }, TODAY)).toBe("informe o sexo do documento");
    expect(profileCheckProblem({ birthDate: "1990-01-01", sex: "male", genderIdentity: "" }, TODAY)).toBeNull();
  });

  it("mostra o declarado e devolve cada correção", () => {
    const onChange = vi.fn();
    render(<ProfileCheck declared={DECLARED} value={initialProfileCheck(DECLARED)} today={TODAY} onChange={onChange} />);
    expect(screen.getByText("Declarado pelo cidadão: nascimento 02/04/1963 (63 anos) · sexo feminino · identidade de gênero Mulher cis"))
      .not.toBeNull();
    fireEvent.change(screen.getByLabelText("Sexo (documento)"), { target: { value: "male" } });
    expect(onChange).toHaveBeenLastCalledWith({ birthDate: "1963-04-02", sex: "male", genderIdentity: "cis_woman" });
    fireEvent.change(screen.getByLabelText("Identidade de gênero (opcional)"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ birthDate: "1963-04-02", sex: "female", genderIdentity: "" });
  });

  it("perfil já conferido no posto é dito", () => {
    render(<ProfileCheck declared={{ ...DECLARED, profile_source: "verified" }} value={initialProfileCheck(DECLARED)} today={TODAY} onChange={vi.fn()} />);
    expect(screen.getByText(/já conferido no posto/)).not.toBeNull();
  });
});
