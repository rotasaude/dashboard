// Lista de passageiros da viagem (módulo 30, F-30.2) numa janela nova por um endereço `blob:` — molde do `openGuide` do 26a: a janela
// abre em branco no clique (depois de um await o navegador a trataria como pop-up), nada de id ou dado pessoal na URL, sem cache
// (o blob é revogado em 60 s). O PDF não leva CPF, CNS nem dado clínico (api). 404 → "lista não encontrada"; outras → `transportError`.
import { ApiError, fetchTripManifest } from "../../lib/api";
import { transportError } from "../../lib/transport";

export const MANIFEST_POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para ver a lista";
export const MANIFEST_NOT_FOUND = "lista não encontrada";
const BLOB_TTL_MS = 60_000;

export async function openManifest(tripId: string): Promise<{ ok: true } | { ok: false; text: string }> {
  const win = window.open("", "_blank");
  if (!win) return { ok: false, text: MANIFEST_POPUP_BLOCKED };
  try { win.opener = null; } catch { /* algumas janelas não deixam */ }
  try {
    const file = await fetchTripManifest(tripId);
    const url = URL.createObjectURL(file.blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), BLOB_TTL_MS);
    return { ok: true };
  } catch (err) {
    win.close();
    return { ok: false, text: err instanceof ApiError && err.status === 404 ? MANIFEST_NOT_FOUND : transportError(err) };
  }
}
