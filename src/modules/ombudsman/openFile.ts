// Abrir um anexo da ouvidoria (módulo 33; Q14, D18): o endereço curto (5 min, preso ao usuário) é pedido, o arquivo é lido com
// a sessão e aberto numa janela nova por um endereço `blob:` — nada do conteúdo passa pela URL da aplicação. Molde de
// `printDocument`: a janela abre NO CLIQUE (antes de qualquer await), senão o navegador a trata como pop-up; bloqueada, nem o
// endereço é pedido (o pedido grava trilha no api). 410 `link_expired` e outras recusas voltam como a frase de quem chama.
import { fetchOmbudsmanFile } from "../../lib/api";
import { POPUP_BLOCKED } from "../documents/printDocument";

const FILE_URL_TTL_MS = 60_000;

export async function openFile(getUrl: () => Promise<string>, errorText: (err: unknown) => string): Promise<string | null> {
  const win = window.open("", "_blank");
  if (!win) return POPUP_BLOCKED;
  try {
    const { blob } = await fetchOmbudsmanFile(await getUrl());
    const url = URL.createObjectURL(blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), FILE_URL_TTL_MS);
    return null;
  } catch (err) {
    win.close();
    return errorText(err);
  }
}
