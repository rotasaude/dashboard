// src/lib/openingImport.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { BNAFAR_ERRORS } from "./bnafarErrors";
import {
  IMPORT_ERRORS, OPENING_IMPORT_HEADER, OPENING_IMPORT_MAX_BYTES, ROWS_PAGE, ROW_CODES, ROW_ERRORS, appliedText, discardedText, fileProblem,
  fmtCentsBRL, headerProblem, importErrorText, importStatusView, missingSendFieldsText, readFirstLine, revertBlockedText, revertedText, rowErrorText
} from "./openingImport";
import { openingImport } from "../test/bnafarFixtures";

const sized = (name: string, size: number): File => {
  const f = new File([ "x" ], name, { type: "text/csv" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("openingImport", () => {
  it("constantes do contrato §5 e da Q11", () => {
    expect(OPENING_IMPORT_HEADER).toBe("cnes;tipo_produto;codigo_produto;ampp;lote;validade;quantidade;valor_unitario;cnpj_fabricante;registro_anvisa;programa");
    expect(OPENING_IMPORT_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(ROWS_PAGE).toBe(100);
  });

  it.each([
    [ "sem arquivo", null, "escolha a planilha (.csv)" ],
    [ ".xlsx", sized("saldo.xlsx", 100), "a planilha é um arquivo .csv separado por ponto e vírgula — salve como CSV UTF-8" ],
    [ "5 MB + 1", sized("saldo.csv", 5 * 1024 * 1024 + 1), "o arquivo passa de 5 MB — divida a planilha por local" ],
    [ "SALDO.CSV com exatamente 5 MB", sized("SALDO.CSV", 5 * 1024 * 1024), null ]
  ])("fileProblem: %s", (_name, file, expected) => {
    expect(fileProblem(file)).toBe(expected);
  });

  it("headerProblem: exato, com BOM e \\r passam; vírgula, colunas trocadas e vazio recusam", () => {
    const refused = "o cabeçalho não é o da planilha padrão — baixe o modelo e copie as colunas na mesma ordem";
    expect(headerProblem(OPENING_IMPORT_HEADER)).toBeNull();
    expect(headerProblem(`﻿${OPENING_IMPORT_HEADER}\r`)).toBeNull();
    expect(headerProblem(OPENING_IMPORT_HEADER.replace(/;/g, ","))).toBe(refused);
    expect(headerProblem(OPENING_IMPORT_HEADER.replace("lote;validade", "validade;lote"))).toBe(refused);
    expect(headerProblem("")).toBe(refused);
  });

  it("readFirstLine: só a primeira linha, sem o fim de linha", async () => {
    const f = new File([ `﻿${OPENING_IMPORT_HEADER}\r\n2384299;medicamento;267645;;L1;2027-06-30;10;12,50;;;\r\n` ], "s.csv");
    expect(headerProblem(await readFirstLine(f))).toBeNull();
    expect(await readFirstLine(new File([ "a;b" ], "s.csv"))).toBe("a;b");
  });

  it("os 21 códigos de linha têm frase, sem sublinhado, pela tabela do envio; o desconhecido volta cru", () => {
    expect(ROW_CODES).toHaveLength(21);
    for (const code of ROW_CODES) {
      expect(ROW_ERRORS[code], code).toBe(BNAFAR_ERRORS[code]);
      expect(rowErrorText(code)).not.toContain("_");
    }
    expect(rowErrorText("linha_nova")).toBe("linha_nova");
    expect(rowErrorText("constructor")).toBe("constructor");
  });

  it("recusas da importação: frase sem sublinhado; o 413 cita as 20.000 linhas; o desconhecido não some", () => {
    for (const code of Object.keys(IMPORT_ERRORS)) {
      expect(IMPORT_ERRORS[code]).not.toContain("_");
      expect(importErrorText(new ApiError(409, { error: code }, "x"))).toBe(IMPORT_ERRORS[code]);
    }
    expect(IMPORT_ERRORS.file_too_large).toBe("o arquivo passa de 5 MB ou de 20.000 linhas — divida a planilha por local");
    expect(IMPORT_ERRORS.missing_role).toBe("só o administrador municipal ou o almoxarife do almoxarifado central importa o saldo inicial");
    expect(IMPORT_ERRORS).not.toHaveProperty("import_in_progress");
    expect(importErrorText(new ApiError(422, { error: "erro_novo" }, "x"))).toContain("erro_novo");
  });

  it("revert_blocked nomeia os locais pelo relatório", () => {
    const i = openingImport();
    expect(revertBlockedText([ "l2" ], i.report)).toBe(`${IMPORT_ERRORS.revert_blocked}: Farmácia UBS Centro.`);
    expect(revertBlockedText([ "l2", "lx" ], i.report)).toBe(`${IMPORT_ERRORS.revert_blocked}: Farmácia UBS Centro, Local sem nome.`);
    expect(revertBlockedText([], i.report)).toBe(`${IMPORT_ERRORS.revert_blocked}.`);
    const unnamed = { ...i.report, totals_by_location: [ { ...i.report.totals_by_location[0], location_name: null } ] };
    expect(revertBlockedText([ "l2" ], unnamed)).toBe(`${IMPORT_ERRORS.revert_blocked}: Local sem nome.`);
  });

  it("situação, valor e frases de resultado", () => {
    expect(importStatusView("uploaded").label).toBe("recebida");
    expect(importStatusView("validated").label).toBe("conferida");
    expect(importStatusView("applied").label).toBe("aplicada");
    expect(importStatusView("discarded").label).toBe("descartada");
    expect(importStatusView("reverted").label).toBe("desfeita");
    expect(importStatusView("situacao_nova").label).toBe("situacao_nova");
    expect(fmtCentsBRL(123456)).toBe("R$ 1.234,56");
    expect(appliedText(openingImport({ status: "applied" }))).toBe(
      "Saldo inicial aplicado: 8 linhas em 1 local. O envio à BNAFAR desses locais começa amanhã, se o envio estiver ligado."
    );
    expect(revertedText).toBe("Importação desfeita: as aberturas foram estornadas.");
    expect(discardedText).toBe("Importação descartada; o arquivo foi apagado.");
    expect(missingSendFieldsText(1)).toBe("1 linha sem os dados do envio — os lotes ficam nas Pendências do envio à BNAFAR");
    expect(missingSendFieldsText(3)).toBe("3 linhas sem os dados do envio — os lotes ficam nas Pendências do envio à BNAFAR");
  });
});
