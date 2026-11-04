// Arquivo do módulo 30 (lista de passageiros, comprovante do TFD) numa janela nova por um endereço `blob:` — molde do `openLabPdf`:
// a janela abre em branco no clique (depois de um await o navegador a trataria como pop-up), sem `opener`, nada de id ou dado pessoal
// na URL, sem cache (o blob é revogado em 60 s). A recusa vira frase de quem chama; a janela em branco fecha.
const BLOB_TTL_MS = 60_000;

export async function openBlobWindow(fetchFile: () => Promise<{ blob: Blob }>, blockedText: string, errorText: (err: unknown) => string):
  Promise<{ ok: true } | { ok: false; text: string }> {
  const win = window.open("", "_blank");
  if (!win) return { ok: false, text: blockedText };
  try { win.opener = null; } catch { /* algumas janelas não deixam */ }
  try {
    const file = await fetchFile();
    const url = URL.createObjectURL(file.blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), BLOB_TTL_MS);
    return { ok: true };
  } catch (err) {
    win.close();
    return { ok: false, text: errorText(err) };
  }
}
