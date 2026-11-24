// src/modules/zoonoses/AnimalHistory.tsx
// Ficha e histórico do animal (módulo 35b, F-35.11). A leitura grava a trilha `animal.viewed` (NOMINAL_QUERY: lida ao abrir e depois
// de uma ação, nunca sozinha). O tutor aparece só como `display_name`; o microchip só como "com microchip"/"sem microchip" (o api
// nunca devolve o número). Os rótulos de produto vêm dos domínios; unidade e estada mostram só tipo e datas.
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getAnimal, type AnimalHistory as History } from "../../lib/api";
import { fmtDay } from "../../lib/homeVisits";
import { NOMINAL_QUERY, ZOO_ANIMAL_KEY, animalDisplayName, nextAnimalStatuses, observationOutcomeLabel, observationStateLabel, zooLabel, zoonosesError } from "../../lib/zoonoses";
import { ActionButton } from "../../components/ActionButton";
import { EmptyState } from "../../components/EmptyState";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { grid, list, muted, panel, row, title } from "../exams/styles";
import { useZooDomains } from "./useZooDomains";

export const FINAL_STATUS_NOTE = "Situação final: o cadastro não muda mais.";
export const hasOpenStay = (h: Pick<History, "stays">): boolean => h.stays.some((s) => s.exited_on === null && s.exit_kind === null);
export const isFinalStatus = (status: string): boolean => nextAnimalStatuses(status).length === 0;

function Section({ name, empty, children }: { name: string; empty: boolean; children: ReactNode }) {
  return (
    <section aria-label={name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h4 style={title}>{name}</h4>
      {empty ? <p style={muted}>nenhum registro</p> : <ul style={list}>{children}</ul>}
    </section>
  );
}

// `editor`: quando passado, ocupa o lugar do botão Editar (a mesma leitura serve ao formulário, sem segunda trilha).
export function AnimalHistory({ id, onEdit, editor }: { id: string; onEdit(h: History): void; editor?: (h: History) => ReactNode }) {
  const domains = useZooDomains().data;
  const q = useQuery({ queryKey: [ ZOO_ANIMAL_KEY, id ], queryFn: () => getAnimal(id), ...NOMINAL_QUERY });
  if (q.isLoading) return <p style={muted}>carregando…</p>;
  if (q.isError || !q.data) return <EmptyState title={zoonosesError(q.error)} />;
  const a = q.data;
  const product = (pid: string) => domains?.products.find((p) => p.id === pid)?.name ?? pid;
  const final = isFinalStatus(a.status);
  const editing = final ? null : editor?.(a) ?? null;

  return (
    <article aria-label={`Animal ${animalDisplayName(a.name, a.species)}`} style={panel}>
      <div style={row}>
        <strong>{animalDisplayName(a.name, a.species)}</strong>
        <Tag tone={a.status === "active" ? "ok" : "neutral"}>{zooLabel(domains?.animal_statuses, a.status)}</Tag>
        {a.neutered && <Tag tone="neutral">castrado</Tag>}
      </div>
      <div style={grid}>
        <KeyValue k="Espécie" v={zooLabel(domains?.species, a.species)} mono={false} />
        <KeyValue k="Sexo" v={zooLabel(domains?.sexes, a.sex)} mono={false} />
        {a.size && <KeyValue k="Porte" v={zooLabel(domains?.sizes, a.size)} mono={false} />}
        {a.coat && <KeyValue k="Pelagem" v={a.coat} mono={false} />}
        {a.breed && <KeyValue k="Raça" v={a.breed} mono={false} />}
        {a.birth_estimate_on && <KeyValue k="Nascimento (estimado)" v={a.birth_estimate_on.slice(0, 7).split("-").reverse().join("/")} mono={false} />}
        <KeyValue k="Microchip" v={a.has_microchip ? "com microchip" : "sem microchip"} mono={false} />
        {a.registry_number && <KeyValue k="Registro" v={a.registry_number} mono={false} />}
        <KeyValue k="Tutor" v={a.tutor ? (a.tutor.display_name ?? "sem nome") : a.community ? "comunitário" : "tutor não identificado"} mono={false} />
        <KeyValue k="Domicílio" v={a.household_id ? "com domicílio" : "sem domicílio"} mono={false} />
        {a.status_on && <KeyValue k="Situação desde" v={fmtDay(a.status_on)} mono={false} />}
      </div>

      {editing ?? (
        final ? <p style={muted}>{FINAL_STATUS_NOTE}</p> : <div style={row}><ActionButton variant="secondary" onClick={() => onEdit(a)}>Editar</ActionButton></div>
      )}

      <Section name="Vacinações" empty={a.vaccinations.length === 0}>
        {a.vaccinations.map((v) => (
          <li key={v.id}>
            {fmtDay(v.vaccinated_on)} · {zooLabel(domains?.modalities, v.modality)} · {product(v.vector_product_id)}
            {v.adverse_event ? " · evento adverso" : ""}{v.cancelled ? " · anulada" : ""}
          </li>
        ))}
      </Section>
      <Section name="Observações" empty={a.observations.length === 0}>
        {a.observations.map((o) => (
          <li key={o.id}>
            exposição em {fmtDay(o.exposure_on)} · até {fmtDay(o.ends_on)} · {o.place === "shelter" ? "no canil" : "em casa"} · {observationStateLabel(o.state)}
            {o.outcome ? ` · ${observationOutcomeLabel(o.outcome)}${o.outcome_on ? ` em ${fmtDay(o.outcome_on)}` : ""}` : ""}
          </li>
        ))}
      </Section>
      <Section name="Exames de leishmaniose" empty={a.tests.length === 0}>
        {a.tests.map((t) => (
          <li key={t.id}>
            {t.label} · coleta {fmtDay(t.collected_on)}
            {t.dpp_result ? ` · TR-DPP ${zooLabel(domains?.dpp_results, t.dpp_result).toLowerCase()}` : ""}
            {t.elisa_result ? ` · ELISA ${zooLabel(domains?.elisa_results, t.elisa_result).toLowerCase()}` : ""}
            {t.outcome ? ` · ${zooLabel(domains?.leish_decisions, t.outcome.decision)} em ${fmtDay(t.outcome.decided_on)}` : ""}
          </li>
        ))}
      </Section>
      <Section name="Coleiras" empty={a.collars.length === 0}>
        {a.collars.map((c) => (
          <li key={c.id}>
            {product(c.vector_product_id)} · colocada em {fmtDay(c.placed_on)} · troca em {fmtDay(c.due_on)}
            {c.removed_on ? ` · retirada em ${fmtDay(c.removed_on)}${c.removal_reason ? ` (${zooLabel(domains?.removal_reasons, c.removal_reason).toLowerCase()})` : ""}` : ""}
          </li>
        ))}
      </Section>
      <Section name="Estadas no canil" empty={a.stays.length === 0}>
        {a.stays.map((s) => (
          <li key={s.id}>
            {zooLabel(domains?.entry_kinds, s.entry_kind)} em {fmtDay(s.entered_on)}
            {s.exit_kind ? ` · saída: ${zooLabel(domains?.exit_kinds, s.exit_kind).toLowerCase()}${s.exited_on ? ` em ${fmtDay(s.exited_on)}` : ""}` : " · estada aberta"}
          </li>
        ))}
      </Section>
      <Section name="Castrações" empty={a.neuterings.length === 0}>
        {a.neuterings.map((n) => <li key={n.id}>{fmtDay(n.performed_on)} · {n.veterinarian.name} ({n.veterinarian.crmv})</li>)}
      </Section>
      {a.euthanasia && (
        <Section name="Eutanásia" empty={false}>
          <li>
            {fmtDay(a.euthanasia.performed_on)} · {zooLabel(domains?.euthanasia_reasons, a.euthanasia.reason)} ·{" "}
            {a.euthanasia.legal_basis.map((b) => zooLabel(domains?.legal_bases, b)).join(", ")} · {a.euthanasia.veterinarian.name} ({a.euthanasia.veterinarian.crmv})
          </li>
        </Section>
      )}
    </article>
  );
}
