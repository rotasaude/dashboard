// Entradas que chegam pela URL no host da cidade (Plano 6):
//   ?grant=  → operador vindo do console, ou usuário voltando do gov.br
//   ?invite= → primeiro municipal_admin aceitando o convite
//   ?reset=  → link do e-mail de redefinição de senha
// O grant vem primeiro: ele vale 60 s e uso único, então não pode esperar.
export type EntryKind = "grant" | "invite" | "reset";
export interface Entry { kind: EntryKind; token: string }

const ORDER: EntryKind[] = [ "grant", "invite", "reset" ];

export function readEntryFromUrl(search: string = window.location.search): Entry | null {
  const params = new URLSearchParams(search);
  for (const kind of ORDER) {
    const token = params.get(kind);
    if (token && token.trim() !== "") return { kind, token };
  }
  return null;
}

export function clearEntryFromUrl(): void {
  const url = new URL(window.location.href);
  ORDER.forEach((kind) => url.searchParams.delete(kind));
  window.history.replaceState({}, "", url.toString());
}
