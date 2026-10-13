// Rótulos dos estados de uma versão de protocolo, iguais na lista, no detalhe e
// no editor (PR-09, PR-14): "em uso", não "active".
const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  in_review: "em revisão",
  published: "publicada",
  active: "em uso",
  retired: "aposentada"
};

export function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}
