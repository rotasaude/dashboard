// Dica do motivo mínimo (spec 6b, FC-12): o botão bloqueado diz o que falta.
export function reasonHint(text: string, min = 10): string | null {
  const missing = min - text.trim().length;
  return missing > 0 ? `mínimo de ${min} caracteres — faltam ${missing}` : null;
}

export function ReasonHint({ id, text, min = 10 }: { id: string; text: string; min?: number }) {
  const hint = reasonHint(text, min);
  return hint ? <p id={id} style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{hint}</p> : null;
}
