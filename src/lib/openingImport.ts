// Regras e frases da planilha do saldo inicial (módulo 27b; contrato §5, Q11, Q20, Q24, Q26, Q36–Q38; F-17–F-19), sem React.
// O api lê, valida e aplica: a tela só recusa antes o que ele recusaria de certo (sem arquivo, outra extensão, acima de 5 MB, cabeçalho
// diferente) e mostra o relatório como vem. A planilha e o base64 só vivem no estado do formulário; o nome do arquivo não vai ao api.
// Frases propostas, salvo as do contrato. Código desconhecido aparece cru.
import { ApiError, errorCode, type OpeningImport, type OpeningImportReport } from "./api";
import { bnafarError, fmtCents } from "./bnafar";
import { BNAFAR_ERRORS, rowErrorText } from "./bnafarErrors";

export { rowErrorText };

export const OPENING_IMPORT_HEADER = "cnes;tipo_produto;codigo_produto;ampp;lote;validade;quantidade;valor_unitario;cnpj_fabricante;registro_anvisa;programa";
export const OPENING_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
// O máximo do api (`limit` até 100).
export const ROWS_PAGE = 100;
const FIRST_LINE_BYTES = 64 * 1024;

// ─── Antes do envio ─────────────────────────────────────────────────────────
export function fileProblem(file: File | null | undefined): string | null {
  if (!file) return "escolha a planilha (.csv)";
  if (!/\.csv$/i.test(file.name)) return "a planilha é um arquivo .csv separado por ponto e vírgula — salve como CSV UTF-8";
  if (file.size > OPENING_IMPORT_MAX_BYTES) return "o arquivo passa de 5 MB — divida a planilha por local";
  return null;
}

// Q17: o BOM do Excel e o `\r` do fim de linha não contam.
export function headerProblem(firstLine: string): string | null {
  const line = firstLine.replace(/^﻿/, "").replace(/\r$/, "");
  return line === OPENING_IMPORT_HEADER ? null : "o cabeçalho não é o da planilha padrão — baixe o modelo e copie as colunas na mesma ordem";
}

// Só o começo do arquivo (o tamanho já foi conferido): a primeira linha, sem o fim de linha.
export function readFirstLine(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split("\n")[0].replace(/\r$/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsText(file.slice(0, FIRST_LINE_BYTES), "utf-8");
  });
}

// ─── Linhas e recusas ───────────────────────────────────────────────────────
// Os 21 códigos de linha do api (validator.rb:40-42), com as frases da tabela única do envio (sem duplicar).
export const ROW_CODES = [
  "cnes_unknown", "invalid_product_type", "product_unknown", "item_not_allowed_here", "domain_disabled", "invalid_lot_number", "invalid_date",
  "expired_lot", "invalid_quantity", "invalid_price", "invalid_cnpj", "invalid_anvisa", "program_unknown", "ampp_unknown", "ampp_not_in_vmp",
  "anvisa_mismatch", "manufacturer_not_in_catalog", "lot_mismatch", "duplicate_line", "opening_exists", "too_many_lots"
] as const;
export const ROW_ERRORS: Record<string, string> = Object.fromEntries(ROW_CODES.map((code) => [ code, BNAFAR_ERRORS[code] ]));

// Recusas do envio e dos atos. Sem `import_in_progress`: o api não tem (F-17).
export const IMPORT_ERRORS: Record<string, string> = {
  invalid_file: BNAFAR_ERRORS.invalid_file,
  file_too_large: BNAFAR_ERRORS.file_too_large,
  revert_blocked: BNAFAR_ERRORS.revert_blocked,
  opening_import_changed: BNAFAR_ERRORS.opening_import_changed,
  expected_version_required: BNAFAR_ERRORS.expected_version_required,
  missing_role: "só o administrador municipal ou o almoxarife do almoxarifado central importa o saldo inicial",
  not_found: "esta importação não existe mais — a lista foi relida"
};

export function importErrorText(err: unknown): string {
  const code = errorCode(err);
  if (code && Object.prototype.hasOwnProperty.call(IMPORT_ERRORS, code)) return IMPORT_ERRORS[code];
  return bnafarError(err);
}

// F-19: o 409 `revert_blocked` traz os ids dos locais; o nome vem dos totais do relatório.
export function revertBlockedText(locations: string[], report: OpeningImportReport): string {
  const names = new Map(report.totals_by_location.map((t) => [ t.stock_location_id, t.location_name ]));
  const named = locations.map((id) => names.get(id) || "Local sem nome");
  return named.length ? `${IMPORT_ERRORS.revert_blocked}: ${named.join(", ")}.` : `${IMPORT_ERRORS.revert_blocked}.`;
}

export function blockedLocations(err: unknown): string[] {
  const body = err instanceof ApiError ? (err.body as { locations?: unknown }) : null;
  return Array.isArray(body?.locations) ? body.locations.filter((l): l is string => typeof l === "string") : [];
}

// ─── Situação, valores e resultados ─────────────────────────────────────────
const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" }> = {
  uploaded: { label: "recebida", tone: "neutral" },
  validated: { label: "conferida", tone: "info" },
  applied: { label: "aplicada", tone: "ok" },
  discarded: { label: "descartada", tone: "neutral" },
  reverted: { label: "desfeita", tone: "warn" }
};
export function importStatusView(status: string): { label: string; tone: string } {
  return Object.prototype.hasOwnProperty.call(STATUS, status) ? STATUS[status] : { label: status, tone: "neutral" };
}

export const fmtCentsBRL = (cents: number): string => `R$ ${fmtCents(cents)}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function appliedText(i: Pick<OpeningImport, "rows_valid" | "report">): string {
  const rows = i.report?.rows_valid ?? i.rows_valid;
  const places = i.report?.totals_by_location.length ?? 0;
  return `Saldo inicial aplicado: ${plural(rows, "linha", "linhas")} em ${plural(places, "local", "locais")}. `
    + "O envio à BNAFAR desses locais começa amanhã, se o envio estiver ligado.";
}
export const revertedText = "Importação desfeita: as aberturas foram estornadas.";
export const discardedText = "Importação descartada; o arquivo foi apagado.";

// Q26: aviso, não erro.
export const missingSendFieldsText = (n: number): string =>
  `${plural(n, "linha", "linhas")} sem os dados do envio — os lotes ficam nas Pendências do envio à BNAFAR`;

export const OPENING_IMPORT_NOTE = "A planilha vira o saldo de abertura de cada local depois de conferida e aplicada. O envio à BNAFAR do local "
  + "começa no dia seguinte, e desfazer só vale antes de qualquer outro movimento ou envio.";
// Q38: o modelo é só o cabeçalho; o conselho fica na tela.
export const BIG_CITY_ADVICE = "Cidade grande: divida a importação por local, uma planilha para cada local. O modelo traz só o cabeçalho; "
  + "cada planilha vai até 5 MB e 20.000 linhas.";
