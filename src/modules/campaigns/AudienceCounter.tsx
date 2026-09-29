import { fmtNumber } from "../../lib/format";
import type { PreviewState } from "./useAudiencePreview";

export function previewText(state: PreviewState, problem: string | null): string {
  if (problem) return `complete o público: ${problem}`;
  switch (state.kind) {
    case "incomplete": return "complete o público para ver a contagem";
    case "loading": return "calculando…";
    case "error": return state.message;
    case "below_minimum": return "menos de 5 — ajuste o público";
    case "ok": return `≈ ${fmtNumber(state.citizens)} pessoas (${fmtNumber(state.phones)} telefones)`;
  }
}

// Mínimo de 5 telefones (D8): só uma contagem do público ATUAL libera.
export function previewAllowsSend(state: PreviewState): state is Extract<PreviewState, { kind: "ok" }> {
  return state.kind === "ok";
}

export function AudienceCounter({ state, problem }: { state: PreviewState; problem: string | null }) {
  const blocked = problem !== null || state.kind === "below_minimum" || state.kind === "error";
  return (
    <p role="status" aria-live="polite" aria-label="Contagem do público"
      style={{ margin: 0, fontSize: 14, fontWeight: 600, color: blocked ? "var(--down)" : "var(--ink)" }}>
      {previewText(state, problem)}
    </p>
  );
}
