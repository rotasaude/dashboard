// Comprovante, etiquetas, mapa de trabalho e laudo numa janela nova por um
// endereço `blob:` (nada do conteúdo passa pela URL da aplicação nem pelo
// cache do React Query). A janela abre no clique — depois de um await o
// navegador trataria como pop-up. A mensagem do erro (que traz o caminho)
// nunca sai daqui: só a frase.
import type { SignatureFile } from "../../lib/api";
import { labError } from "../../lib/lab";
import { POPUP_BLOCKED } from "../exams/openExamPdf";

const BLOB_TTL_MS = 60_000;

export async function openLabPdf(fetchFile: () => Promise<SignatureFile>): Promise<{ ok: true } | { ok: false; text: string }> {
  const win = window.open("", "_blank");
  if (!win) return { ok: false, text: POPUP_BLOCKED.replace("o laudo", "o PDF") };
  try { win.opener = null; } catch { /* algumas janelas não deixam */ }
  try {
    const file = await fetchFile();
    const url = URL.createObjectURL(file.blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), BLOB_TTL_MS);
    return { ok: true };
  } catch (err) {
    win.close();
    return { ok: false, text: labError(err) };
  }
}
