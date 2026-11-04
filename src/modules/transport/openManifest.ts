// Lista de passageiros da viagem (módulo 30, F-30.2) numa janela nova por um endereço `blob:` (`openBlobWindow`). O PDF não leva CPF,
// CNS nem dado clínico (api). 404 → "lista não encontrada"; outras → `transportError`.
import { ApiError, fetchTripManifest } from "../../lib/api";
import { transportError } from "../../lib/transport";
import { openBlobWindow } from "./openBlobWindow";

export const MANIFEST_POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para ver a lista";
export const MANIFEST_NOT_FOUND = "lista não encontrada";

export function openManifest(tripId: string): Promise<{ ok: true } | { ok: false; text: string }> {
  return openBlobWindow(() => fetchTripManifest(tripId), MANIFEST_POPUP_BLOCKED,
    (err) => (err instanceof ApiError && err.status === 404 ? MANIFEST_NOT_FOUND : transportError(err)));
}
