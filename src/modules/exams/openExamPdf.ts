// src/modules/exams/openExamPdf.ts
// Laudo numa janela nova por um endereço `blob:` (nada do conteúdo passa pela
// URL da aplicação nem pelo cache do React Query). A janela abre no clique:
// depois de um await o navegador trataria como pop-up — e, bloqueada, o laudo
// nem é baixado. Link vencido (C9: 410 `link_expired`) devolve `expired` para
// quem chamou reler o exame (novo `pdf_url`); 404 é "não achado". A mensagem
// do erro (que traz `/exams/files/<token>`) nunca sai daqui: só a frase.
// `reread`: 410 e 404 pedem para quem chamou reler o exame (novo `pdf_url`).
import { ApiError, fetchExamPdf } from "../../lib/api";
import { PDF_LINK_EXPIRED, PDF_NOT_FOUND, examError, pdfLinkExpired } from "../../lib/exams";

export const POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para ver o laudo";
const BLOB_TTL_MS = 60_000;

export type PdfOutcome = { ok: true } | { ok: false; expired: boolean; reread: boolean; text: string };

export async function openExamPdf(pdfUrl: string): Promise<PdfOutcome> {
  const win = window.open("", "_blank");
  if (!win) return { ok: false, expired: false, reread: false, text: POPUP_BLOCKED };
  try { win.opener = null; } catch { /* algumas janelas não deixam */ }
  try {
    const file = await fetchExamPdf(pdfUrl);
    const url = URL.createObjectURL(file.blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), BLOB_TTL_MS);
    return { ok: true };
  } catch (err) {
    win.close();
    const expired = pdfLinkExpired(err);
    const missing = err instanceof ApiError && err.status === 404;
    const text = expired ? PDF_LINK_EXPIRED : missing ? PDF_NOT_FOUND : examError(err);
    return { ok: false, expired, reread: expired || missing, text };
  }
}
