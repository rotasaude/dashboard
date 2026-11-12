// Folha para impressão da ouvidoria (módulo 33: comprovante do registro, relatório anual). Molde de `printDocument`: a janela
// abre NO CLIQUE, antes de qualquer trabalho (senão o navegador a trata como pop-up); bloqueada, devolve POPUP_BLOCKED. O
// documento é montado por DOM, só com `textContent` (nunca `innerHTML`): um valor com marcação sai como texto. Sem cor: o
// impresso usa as do navegador.
import { POPUP_BLOCKED } from "../documents/printDocument";

const SHEET_STYLE = "body{font-family:sans-serif;margin:24px}table{border-collapse:collapse;margin:16px 0}"
  + "th{text-align:left;padding:4px 16px 4px 0;font-weight:600}td{padding:4px 0}h2{font-size:15px;margin:16px 0 4px}";

export function printSheet(title: string, rows: [ string, string ][], paragraphs: { title: string; text: string }[] = []): string | null {
  const win = window.open("", "_blank");
  if (!win) return POPUP_BLOCKED;
  const doc = win.document;
  doc.title = title;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  doc.head.append(el("style", SHEET_STYLE));
  const table = el("table");
  const tbody = el("tbody");
  for (const [ key, value ] of rows) {
    const tr = el("tr");
    tr.append(el("th", key), el("td", value));
    tbody.append(tr);
  }
  table.append(tbody);
  const parts: HTMLElement[] = [ el("h1", title), table ];
  for (const p of paragraphs) {
    if (p.title !== "") parts.push(el("h2", p.title));
    parts.push(el("p", p.text));
  }
  doc.body.replaceChildren(...parts);
  win.focus();
  win.print();
  return null;
}
