import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { attendanceError, isValidCpf, maskCpf } from "./attendance";

describe("attendance helpers", () => {
  it("mascara e valida CPF", () => {
    expect(maskCpf("52998224725")).toBe("529.982.247-25");
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });

  it("traduz os erros do balcão sem confundir com o código do autenticador", () => {
    expect(attendanceError(new ApiError(422, { error: "invalid_code" }, "x")))
      .toBe("código não confere — confira com o cidadão");
    expect(attendanceError(new ApiError(422, { error: "code_expired" }, "x")))
      .toBe("código vencido ou já usado — peça ao cidadão para gerar outro código");
    expect(attendanceError(new ApiError(422, { error: "code_exhausted" }, "x")))
      .toBe("tentativas esgotadas — peça ao cidadão para gerar outro código");
    expect(attendanceError(new ApiError(409, { error: "already_verified", verified_at: "2026-09-24T12:00:00Z" }, "x")))
      .toMatch(/^cadastro já verificado em /);
    expect(attendanceError(new ApiError(403, { error: "own_verification" }, "x")))
      .toBe("quem validou não pode desfazer a própria validação");
    expect(attendanceError(new Error("rede"))).toBe("não foi possível concluir — tente de novo");
  });

  it("traduz unit_has_open_attendances", () => {
    expect(attendanceError(new ApiError(409, { error: "unit_has_open_attendances" }, "x")))
      .toBe("há atendimentos abertos nesta unidade — encerre-os antes de desativar");
  });
});
