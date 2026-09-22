// Que ações de ciclo de vida uma versão oferece a QUEM está olhando, e por que
// uma delas estaria desabilitada (spec do dashboard §3; ADR 0016).
//
// É previsão, não decisão: os motivos abaixo são os que o estado lido permite
// antecipar, para o revisor não gastar um código de autenticador numa ação que
// a API recusaria. Quem decide é o command, que trava a linha e reconfere.
import type { SignatureBlock, SignatureState } from "./types";
import type { SignaturePurpose } from "./api";

// Protocols::Signatures::REQUIRED na API.
export const REQUIRED_SIGNATURES = 2;

export type LifecycleKind = "submit" | "sign" | "publish" | "activate" | "retire" | "revert";

export interface Viewer { id: string; roles: string[] }
export interface LifecycleTarget extends SignatureState { version: string; status: string }

export interface LifecycleAction {
  kind: LifecycleKind;
  label: string;
  purpose?: SignaturePurpose;
  stepUp: boolean;
  needsReason: boolean;
  disabledReason: string | null;
}

// Mesma frase de Protocols::Signatures.shortfall_message (a da API é mais
// longa: traz a finalidade e a contagem de revisores; aqui fica o núcleo).
export function shortfallMessage(missing: number): string {
  return missing === 1 ? "falta 1 assinatura" : `faltam ${missing} assinaturas`;
}

// A finalidade que o status pede: in_review assina publicação, published
// assina ativação. Qualquer outro status não pede assinatura.
export function purposeForStatus(status: string): SignaturePurpose | null {
  if (status === "in_review") return "publication";
  if (status === "published") return "activation";
  return null;
}

function has(viewer: Viewer, ...roles: string[]): boolean {
  return roles.some((role) => viewer.roles.includes(role));
}

function blockFor(target: LifecycleTarget, purpose: SignaturePurpose): SignatureBlock {
  return target.signatures[purpose];
}

function signatureBlocked(target: LifecycleTarget, purpose: SignaturePurpose): string | null {
  if (target.eligibleReviewers < REQUIRED_SIGNATURES) {
    return `a cidade tem ${target.eligibleReviewers} revisor(es) elegível(is); são necessários ${REQUIRED_SIGNATURES}`;
  }
  const missing = blockFor(target, purpose).missing;
  return missing > 0 ? shortfallMessage(missing) : null;
}

// Só editor `user` bloqueia o revisor: um mantenedor que editou a versão é
// outra pessoa, e o id dele vive em outro banco (ADR 0016).
function iEdited(target: LifecycleTarget, viewer: Viewer): boolean {
  return target.editors.some((e) => e.kind === "user" && e.id === viewer.id);
}

function iSigned(target: LifecycleTarget, viewer: Viewer, purpose: SignaturePurpose): boolean {
  return blockFor(target, purpose).signers.some((s) => s.id === viewer.id);
}

function signAction(target: LifecycleTarget, viewer: Viewer, purpose: SignaturePurpose): LifecycleAction {
  const label = purpose === "publication" ? "Assinar publicação" : "Assinar ativação";
  const disabledReason = iEdited(target, viewer)
    ? "você editou esta versão"
    : iSigned(target, viewer, purpose) ? "você já assinou" : null;

  return { kind: "sign", label, purpose, stepUp: true, needsReason: false, disabledReason };
}

function retireAction(): LifecycleAction {
  return { kind: "retire", label: "Aposentar", stepUp: true, needsReason: false, disabledReason: null };
}

export function actionsFor(target: LifecycleTarget, viewer: Viewer): LifecycleAction[] {
  const actions: LifecycleAction[] = [];
  const purpose = purposeForStatus(target.status);

  if (target.status === "draft" && has(viewer, "protocol_author")) {
    actions.push({ kind: "submit", label: "Enviar para revisão", stepUp: false, needsReason: false, disabledReason: null });
  }

  if (purpose && has(viewer, "protocol_reviewer")) {
    actions.push(signAction(target, viewer, purpose));
  }

  if (target.status === "in_review" && has(viewer, "protocol_publisher")) {
    actions.push({
      kind: "publish", label: "Publicar", stepUp: true, needsReason: false,
      disabledReason: signatureBlocked(target, "publication")
    });
  }

  if (target.status === "published" && has(viewer, "protocol_publisher", "municipal_admin")) {
    actions.push({
      kind: "activate", label: "Ativar", stepUp: true, needsReason: false,
      disabledReason: signatureBlocked(target, "activation")
    });
  }

  // R4: a versão ativa nunca é aposentada — só revertida.
  if ([ "draft", "in_review", "published" ].includes(target.status) && has(viewer, "protocol_publisher")) {
    actions.push(retireAction());
  }

  if (target.status === "active" && target.revertible && has(viewer, "protocol_publisher", "municipal_admin")) {
    actions.push({ kind: "revert", label: "Reverter", stepUp: true, needsReason: true, disabledReason: null });
  }

  return actions;
}

export function awaitingMySignature(target: LifecycleTarget, viewer: Viewer): boolean {
  return actionsFor(target, viewer).some((a) => a.kind === "sign" && a.disabledReason === null);
}
