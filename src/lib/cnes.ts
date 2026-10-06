// src/lib/cnes.ts
// CNES da cidade (módulo 16; ADR 0028; spec §5; contratos §5.2). A tela só
// mostra e confirma: nenhuma proposta é aplicada sem a seleção explícita e o
// step-up. CPF e CNS chegam mascarados e saem como vieram. As puladas do
// apply voltam por motivo: stale (mudou desde a leitura), conflict (bateu numa
// regra do cadastro: nome repetido, profissional já ativo) ou outro.
import type { CnesApplyResult, CnesProposal, CnesSide } from "./api";

export const CNES_KEY = [ "cnes" ] as const;

export const PROPOSAL_KIND_LABEL: Record<string, string> = {
  unit: "Unidade", team: "Equipe", member: "Profissional na equipe"
};

export const PROPOSAL_ACTION_LABEL: Record<string, string> = {
  link: "vincular ao CNES", create: "criar a partir do CNES", end: "encerrar (saiu do CNES)"
};

export const CONFIDENCE: Record<string, { label: string; tone: "ok" | "warn" }> = {
  exact: { label: "exato", tone: "ok" },
  probable: { label: "provável — confira", tone: "warn" }
};

const DIVERGENCE_LABEL: Record<string, string> = {
  no_bond_in_cnes: "profissional sem vínculo no CNES",
  cbo_mismatch: "CBO diferente do CNES",
  team_inactive_in_cnes: "equipe desativada no CNES",
  unit_without_cnes: "unidade sem CNES"
};

const SUBJECT_LABEL: Record<string, string> = { unit: "unidade", team: "equipe", professional: "profissional" };

export function describeSide(side: CnesSide | null): string {
  if (!side) return "— (não existe no cadastro)";
  const parts = [
    side.name,
    side.cnes && `CNES ${side.cnes}`,
    side.ine && `INE ${side.ine}`,
    side.cbo && `CBO ${side.cbo}`,
    side.cpf_masked && `CPF ${side.cpf_masked}`,
    side.cns_masked && `CNS ${side.cns_masked}`
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function divergenceLabel(kind: string): string {
  return DIVERGENCE_LABEL[kind] ?? kind;
}

export function subjectLabel(subject: { type: string; label: string }): string {
  return `${SUBJECT_LABEL[subject.type] ?? subject.type} · ${subject.label}`;
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function toggleAll(selected: ReadonlySet<string>, proposals: CnesProposal[]): Set<string> {
  const all = proposals.length > 0 && proposals.every((p) => selected.has(p.id));
  return all ? new Set() : new Set(proposals.map((p) => p.id));
}

// Depois de reler a lista, o que sumiu sai da seleção: nunca vai num lote.
export function pruneSelection(selected: ReadonlySet<string>, proposals: CnesProposal[]): Set<string> {
  const ids = new Set(proposals.map((p) => p.id));
  return new Set([ ...selected ].filter((id) => ids.has(id)));
}

const CONFLICT_WHY = "por conflito com o cadastro da cidade (nome repetido ou profissional já ativo na equipe)";

export function applySummary(r: CnesApplyResult): string {
  const applied = r.applied === 0 ? "Nenhuma proposta aplicada"
    : r.applied === 1 ? "1 proposta aplicada" : `${r.applied} propostas aplicadas`;
  if (r.skipped.length === 0) return `${applied}.`;
  const stale = r.skipped.filter((s) => s.reason === "stale").length;
  const conflict = r.skipped.filter((s) => s.reason === "conflict").length;
  const other = r.skipped.length - stale - conflict;
  const parts: string[] = [];
  if (stale > 0) parts.push(stale === 1 ? "1 pulada porque mudou desde a leitura" : `${stale} puladas porque mudaram desde a leitura`);
  if (conflict > 0) parts.push(conflict === 1 ? `1 pulada ${CONFLICT_WHY}` : `${conflict} puladas ${CONFLICT_WHY}`);
  if (other > 0) parts.push(other === 1 ? "1 pulada por outro motivo" : `${other} puladas por outro motivo`);
  return `${applied}; ${parts.join("; ")} — confira a lista de novo.`;
}
