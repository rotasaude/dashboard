// src/lib/surveillanceForm.ts
// A ficha de notificação individual do Sinan (módulo 25; contrato §14): a tabela
// transcrita de apps/api config/surveillance/sinan-form.yml e a conferência que
// espelha Surveillance::Form. O api só aceita string (ou null para limpar); não
// há obrigatório, condição, data, número nem booleano. A tela recusa, nunca
// corta: o digitado vai como está e o api normaliza (espaço colapsado, pontuação
// de dígitos fora). A ficha é dado de saúde: as mensagens nunca repetem o valor.
import type { NotificationForm } from "./api";
import { UFS } from "./professionals";

export type FormFieldKind = "code" | "text" | "digits" | "uf" | "cbo";
export interface FormFieldSpec {
  key: string; label: string; kind: FormFieldKind;
  // text: tamanho máximo; digits: de min a max, ou `length` exato.
  max?: number; min?: number; length?: number;
  options?: { code: string; label: string }[];
}

// Só nestes estados o api grava a ficha (SaveForm: entered e dismissed travam).
export const FORM_EDITABLE: ReadonlySet<string> = new Set([ "possible", "notified", "investigating", "closed" ]);

const options = (pairs: [ string, string ][]) => pairs.map(([ code, label ]) => ({ code, label }));

export const SINAN_FORM_FIELDS: FormFieldSpec[] = [
  { key: "pregnancy", label: "Gestante", kind: "code", options: options([
    [ "1", "1º trimestre" ], [ "2", "2º trimestre" ], [ "3", "3º trimestre" ], [ "4", "Idade gestacional ignorada" ],
    [ "5", "Não" ], [ "6", "Não se aplica" ], [ "9", "Ignorado" ] ]) },
  { key: "race_color", label: "Raça/Cor", kind: "code", options: options([
    [ "1", "Branca" ], [ "2", "Preta" ], [ "3", "Amarela" ], [ "4", "Parda" ], [ "5", "Indígena" ], [ "9", "Ignorado" ] ]) },
  { key: "schooling", label: "Escolaridade", kind: "code", options: options([
    [ "0", "Analfabeto" ],
    [ "1", "1ª a 4ª série incompleta do EF (antigo primário ou 1º grau)" ],
    [ "2", "4ª série completa do EF (antigo primário ou 1º grau)" ],
    [ "3", "5ª à 8ª série incompleta do EF (antigo ginásio ou 1º grau)" ],
    [ "4", "Ensino fundamental completo (antigo ginásio ou 1º grau)" ],
    [ "5", "Ensino médio incompleto (antigo colegial ou 2º grau)" ],
    [ "6", "Ensino médio completo (antigo colegial ou 2º grau)" ],
    [ "7", "Educação superior incompleta" ], [ "8", "Educação superior completa" ], [ "9", "Ignorado" ], [ "10", "Não se aplica" ] ]) },
  { key: "residence_uf", label: "UF", kind: "uf" },
  { key: "residence_district", label: "Distrito", kind: "text", max: 60 },
  { key: "residence_neighborhood", label: "Bairro", kind: "text", max: 60 },
  { key: "residence_street", label: "Logradouro", kind: "text", max: 60 },
  { key: "residence_number", label: "Número", kind: "text", max: 6 },
  { key: "residence_complement", label: "Complemento", kind: "text", max: 30 },
  { key: "residence_geo1", label: "Geo campo 1", kind: "digits", min: 1, max: 8 },
  { key: "residence_geo2", label: "Geo campo 2", kind: "digits", min: 1, max: 8 },
  { key: "residence_reference", label: "Ponto de referência", kind: "text", max: 70 },
  { key: "residence_zip", label: "CEP", kind: "digits", length: 8 },
  { key: "phone", label: "(DDD) Telefone", kind: "digits", min: 10, max: 11 },
  { key: "residence_zone", label: "Zona", kind: "code", options: options([
    [ "1", "Urbana" ], [ "2", "Rural" ], [ "3", "Periurbana" ], [ "9", "Ignorado" ] ]) },
  { key: "residence_country", label: "País (se residente fora do Brasil)", kind: "text", max: 40 },
  { key: "occupation_cbo", label: "Ocupação (CBO)", kind: "cbo" }
];

// Os valores da tela: sempre string (ausente, null ou outro tipo = vazio). Zero à esquerda fica.
export function formValues(form: NotificationForm | undefined | null, fields: FormFieldSpec[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = form?.[f.key];
    out[f.key] = typeof v === "string" ? v : "";
  }
  return out;
}

// O PATCH leva a ficha inteira. Vazio (ou só espaço) vira null, que limpa o campo; o resto vai como digitado.
export function formBody(values: Record<string, string>, fields: FormFieldSpec[]): NotificationForm {
  const body: NotificationForm = {};
  for (const f of fields) {
    const v = values[f.key] ?? "";
    body[f.key] = v.trim() === "" ? null : v;
  }
  return body;
}

// Como o api lê o texto: espaços colapsados e sem as pontas.
const squish = (s: string): string => s.replace(/\s+/g, " ").trim();
const PUNCTUATION = /[ ().-]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export interface FormProblem { path: string; message: string }

function fieldProblem(f: FormFieldSpec, raw: string): string | null {
  const text = squish(raw);
  if (text === "") return null;
  if (CONTROL.test(raw.replace(/\s/g, " "))) return `${f.label}: caractere não aceito`;
  switch (f.kind) {
    case "code": return f.options?.some((o) => o.code === text) ? null : `${f.label}: escolha um valor da lista`;
    case "uf": return UFS.includes(text.toUpperCase()) ? null : `${f.label}: escolha um valor da lista`;
    case "cbo": return /^\d{6}$/.test(text) ? null : `${f.label}: 6 dígitos`;
    case "text": return [ ...text ].length <= (f.max ?? 0) ? null : `${f.label}: no máximo ${f.max} caracteres`;
    case "digits": {
      const number = text.replace(PUNCTUATION, "");
      if (!/^\d+$/.test(number)) return `${f.label}: só dígitos`;
      const size = number.length;
      if (f.length !== undefined) return size === f.length ? null : `${f.label}: ${f.length} dígitos`;
      return size >= (f.min ?? 1) && size <= (f.max ?? 0) ? null : `${f.label}: de ${f.min ?? 1} a ${f.max} dígitos`;
    }
  }
}

// O primeiro problema, na ordem da ficha, com o path que o api daria (`form.<chave>`).
export function formProblem(values: Record<string, string>, fields: FormFieldSpec[]): FormProblem | null {
  for (const f of fields) {
    const message = fieldProblem(f, values[f.key] ?? "");
    if (message) return { path: `form.${f.key}`, message };
  }
  return null;
}
