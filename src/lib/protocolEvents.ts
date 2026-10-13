// Eventos de protocolo legíveis (spec 6d, PR-11): o nome técnico vira frase e
// o id de quem agiu vira o e-mail que o painel já conhece. O que o api não manda
// (quem ativou, motivo e alvo da reversão, finalidade da assinatura) é card.
const EVENT_LABEL: Record<string, string> = {
  "protocol.draft_saved": "rascunho salvo",
  "protocol.submitted": "enviada para revisão",
  "protocol.signed": "assinatura registrada",
  "protocol.published": "publicada",
  "protocol.activated": "ativada",
  "protocol.retired": "aposentada",
  "protocol.activation_reverted": "ativação revertida"
};

export function eventLabel(name: string): string {
  return EVENT_LABEL[name] ?? name;
}

export interface EventPerson { id: string; email: string | null; kind?: string }

export function actorLabel(actor: string | null | undefined, people: EventPerson[]): string {
  if (!actor) return "sistema";
  const person = people.find((p) => p.id === actor);
  if (!person) return "pessoa da equipe";
  if (person.kind === "maintainer") return "mantenedor";
  return person.email ?? "pessoa da equipe";
}
