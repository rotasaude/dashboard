// src/modules/territory/sectionDraft.ts
// Uma seção da ficha (§15) na tela e no corpo, para as duas fichas. Na tela
// o valor fica como digitado (code → "83"; codes → number[]; bool → "" |
// "true" | "false"; texto, data, dígitos e contagem → string; object →
// Draft); o corpo leva só o preenchido. Contagem que não é inteiro vai como
// veio, para a regra recusar com a frase dela (nunca cortada nem arredondada).
import type { CodedSection } from "../../lib/api";
import type { FieldSpec } from "../../lib/territoryDictionaries";

export type Draft = Record<string, unknown>;

export function toDraft(fields: FieldSpec[], values: CodedSection | null | undefined): Draft {
  const draft: Draft = {};
  for (const spec of fields) {
    const value = values?.[spec.key];
    if (value === null || value === undefined) continue;
    if (spec.type === "object") draft[spec.key] = toDraft(spec.fields ?? [], value as CodedSection);
    else if (spec.type === "codes") draft[spec.key] = Array.isArray(value) ? value : [];
    else draft[spec.key] = String(value);
  }
  return draft;
}

export function fromDraft(fields: FieldSpec[], draft: Draft, visible: (key: string) => boolean = () => true): CodedSection | null {
  const out: CodedSection = {};
  for (const spec of fields) {
    if (!visible(spec.key)) continue;
    const raw = draft[spec.key];
    if (raw === undefined) continue;
    if (spec.type === "object") {
      const nested = fromDraft(spec.fields ?? [], raw as Draft);
      if (nested) out[spec.key] = nested;
      continue;
    }
    if (spec.type === "codes") {
      if (Array.isArray(raw) && raw.length > 0) out[spec.key] = raw as number[];
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    if (spec.type === "bool") out[spec.key] = text === "true";
    else if (spec.type === "code") out[spec.key] = Number(text);
    else if (spec.type === "count") out[spec.key] = /^\d+$/.test(text) ? Number(text) : text;
    else out[spec.key] = text;
  }
  return Object.keys(out).length > 0 ? out : null;
}
