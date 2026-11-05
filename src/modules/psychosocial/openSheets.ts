// Fichas espelho da RAAS (módulo 31, F-31.6) numa janela nova por um endereço `blob:` (`openBlobWindow`, molde do `openManifest`): a
// janela abre em branco no clique, sem `opener`; na URL do api vão só o mês, o id do CAPS e o da matrícula (nunca nome, CNS ou CID).
// Com o mês aberto, o PDF sai como PRÉVIA (só a coordenação lotada); o faturista com mês aberto recebe 409 `month_open` (P43). A
// recusa vira frase de quem chama; a janela em branco fecha.
import { fetchPsySheets } from "../../lib/api";
import { psyError } from "../../lib/psychosocial";
import { openBlobWindow } from "../transport/openBlobWindow";

export const SHEETS_POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para ver as fichas";

export function openSheets(month: string, q: { unitId: string; enrollmentId?: string | null }): Promise<{ ok: true } | { ok: false; text: string }> {
  return openBlobWindow(() => fetchPsySheets(month, { unitId: q.unitId, enrollmentId: q.enrollmentId ?? null }), SHEETS_POPUP_BLOCKED, psyError);
}
