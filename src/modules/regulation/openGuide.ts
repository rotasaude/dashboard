// src/modules/regulation/openGuide.ts
// Guia de encaminhamento (módulo 26a; contrato §13 G8) numa janela nova por um endereço `blob:`: nada do conteúdo
// passa pela URL da aplicação, e a janela abre em branco (sem id nem dado pessoal na URL). Aberta no clique: depois
// de um await o navegador a trataria como pop-up. Sem cache: o blob é revogado em 60 s. 404 → "guia não encontrada";
// outras falhas → a frase de `regulationError`, que nunca repete o corpo do api.
import { ApiError, fetchRegulationGuide } from "../../lib/api";
import { regulationError } from "../../lib/regulation";

export const POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para ver a guia";
export const GUIDE_NOT_FOUND = "guia não encontrada";
const BLOB_TTL_MS = 60_000;

export type GuideOutcome = { ok: true } | { ok: false; text: string };

export async function openGuide(id: string): Promise<GuideOutcome> {
  const win = window.open("", "_blank");
  if (!win) return { ok: false, text: POPUP_BLOCKED };
  try { win.opener = null; } catch { /* algumas janelas não deixam */ }
  try {
    const file = await fetchRegulationGuide(id);
    const url = URL.createObjectURL(file.blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), BLOB_TTL_MS);
    return { ok: true };
  } catch (err) {
    win.close();
    return { ok: false, text: err instanceof ApiError && err.status === 404 ? GUIDE_NOT_FOUND : regulationError(err) };
  }
}
