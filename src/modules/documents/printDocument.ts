// src/modules/documents/printDocument.ts
// Imprimir um documento clínico (módulo 19c; contrato §3): o api devolve o PDF
// assinado (digital e assinado) ou o do modo papel. Lido com a sessão e aberto
// numa janela nova por um endereço `blob:` — nada do conteúdo passa pela URL
// da aplicação. A janela abre NO CLIQUE (antes de qualquer await), senão o
// navegador a trata como pop-up. 409 awaiting_signature (digital ainda não
// assinado) volta como a frase de quem chama.
import { fetchDocumentPdf } from "../../lib/api";

const PDF_URL_TTL_MS = 60_000;
export const POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para imprimir";

export async function printDocument(id: string, errorText: (err: unknown) => string): Promise<string | null> {
  const win = window.open("", "_blank");
  try {
    const { blob } = await fetchDocumentPdf(id);
    if (!win) return POPUP_BLOCKED;
    const url = URL.createObjectURL(blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), PDF_URL_TTL_MS);
    return null;
  } catch (err) {
    win?.close();
    return errorText(err);
  }
}
