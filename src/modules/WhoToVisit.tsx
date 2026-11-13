// src/modules/WhoToVisit.tsx
// Tela "Quem visitar" (módulo 24b, F-24.16): por microárea, quem precisa de visita e por quê. A lista é nominal (`NOMINAL_QUERY`: com trilha,
// nunca relida sozinha); as contagens (`COUNT_QUERY`) não trazem pessoa. Microárea e motivos só valem no "Atualizar". Os motivos vêm em
// frase pronta (`whoReasonText`) — nunca CID nem condição. O atalho "Registrar visita" só aparece a quem registra na equipe e na microárea
// (própria ou atribuída) e leva o alvo à "Folha do dia" só em memória (`onStartVisit`). Nada em storage; a URL só leva ids e o cursor.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  countWhoToVisit, getHomeVisitContext, listWhoToVisit, type HomeVisitTeam, type MicroAreaScope, type VisitMicroArea, type WhoToVisitItem
} from "../lib/api";
import {
  COUNT_QUERY, HV_CONTEXT_KEY, NO_MICRO_AREA, STATIC_QUERY, WHO_COUNT_KEY, WHO_KEY, fmtDay, homeVisitError, whoReasonText
} from "../lib/homeVisits";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { PagedBody, usePaged } from "./homeVisits/usePaged";
import type { VisitStart } from "./homeVisits/useVisitHandoff";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { StatTile } from "../components/StatTile";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";

const PAGE = 50;
const NO_TEAM = "nenhuma equipe encontrada para você";
const SCOPE_TEXT: Record<MicroAreaScope, string> = { responsible: "sua", assigned: "atribuída", team: "da equipe" };
const REASONS: { code: string; label: string }[] = [
  { code: "care_line", label: "Linhas de cuidado" }, { code: "registration_due", label: "Cadastro a vencer" }, { code: "never_visited", label: "Nunca visitadas" }
];
const tiles: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 };
const reasonList: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };

export function WhoToVisit({ onStartVisit }: { onStartVisit?(start: VisitStart): void }) {
  return (
    <HomeVisitGate title="Quem visitar" sub="visita domiciliar · quem precisa de visita" feature={"home_visits"} allow={(r) => r.professional}>
      {() => <WhoBody onStartVisit={onStartVisit} />}
    </HomeVisitGate>
  );
}

function WhoBody({ onStartVisit }: { onStartVisit?(start: VisitStart): void }) {
  const ctx = useQuery({ queryKey: [ HV_CONTEXT_KEY ], queryFn: getHomeVisitContext, ...STATIC_QUERY });
  const [ picked, setPicked ] = useState<string | null>(null);
  if (ctx.isError) return <p role="alert" style={alert}>{homeVisitError(ctx.error)}</p>;
  if (!ctx.data) return <p role="status" style={muted}>Carregando…</p>;
  const teams = ctx.data.teams;
  if (teams.length === 0) return <EmptyState title={NO_TEAM} />;
  const team = teams.find((t) => t.id === picked) ?? teams[0];
  return (
    <div style={stack}>
      {teams.length > 1 && (
        <label style={fieldLabel}>
          Equipe
          <select value={team.id} style={inputStyle} onChange={(e) => setPicked(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.ine}</option>)}
          </select>
        </label>
      )}
      <TeamPanel key={team.id} team={team} onStartVisit={onStartVisit} />
    </div>
  );
}

const microText = (m: VisitMicroArea) => `${m.name ? `${m.code} · ${m.name}` : m.code} (${SCOPE_TEXT[m.scope] ?? m.scope})`;

function TeamPanel({ team, onStartVisit }: { team: HomeVisitTeam; onStartVisit?(start: VisitStart): void }) {
  const first = team.micro_areas[0]?.id ?? "";
  const [ draft, setDraft ] = useState<{ micro: string; reasons: string[] }>({ micro: first, reasons: [] });
  const [ applied, setApplied ] = useState(draft);
  if (team.micro_areas.length === 0) return <EmptyState title={NO_MICRO_AREA} />;
  const toggle = (code: string) => setDraft((d) => ({ ...d, reasons: d.reasons.includes(code) ? d.reasons.filter((c) => c !== code) : [ ...d.reasons, code ] }));
  const scope = team.micro_areas.find((m) => m.id === applied.micro)?.scope;
  const canRegister = team.can_register && (scope === "responsible" || scope === "assigned");
  return (
    <div style={stack}>
      <form style={{ ...row, alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); setApplied(draft); }}>
        <label style={fieldLabel}>Microárea
          <select value={draft.micro} style={inputStyle} onChange={(e) => setDraft((d) => ({ ...d, micro: e.target.value }))}>
            {team.micro_areas.map((m) => <option key={m.id} value={m.id}>{microText(m)}</option>)}
          </select>
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={muted}>Motivo</legend>
          <div style={row}>
            {REASONS.map((r) => (
              <label key={r.code} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={draft.reasons.includes(r.code)} onChange={() => toggle(r.code)} />{r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" style={buttonStyle}>Atualizar</button>
      </form>
      <Counts micro={applied.micro} />
      <List key={`${applied.micro}|${applied.reasons.join(",")}`} team={team} micro={applied.micro} reasons={applied.reasons} canRegister={canRegister} onStartVisit={onStartVisit} />
    </div>
  );
}

function Counts({ micro }: { micro: string }) {
  const counts = useQuery({ queryKey: [ WHO_COUNT_KEY, micro ], queryFn: () => countWhoToVisit(micro), ...COUNT_QUERY });
  if (counts.isError) return <p role="alert" style={alert}>{homeVisitError(counts.error)}</p>;
  return (
    <div style={tiles}>
      <StatTile label="Linhas de cuidado" value={counts.data?.care_line} />
      <StatTile label="Cadastro a vencer" value={counts.data?.registration_due} />
      <StatTile label="Nunca visitadas" value={counts.data?.never_visited} />
      <StatTile label="Pessoas" value={counts.data?.people} />
    </div>
  );
}

function List({ team, micro, reasons, canRegister, onStartVisit }: {
  team: HomeVisitTeam; micro: string; reasons: string[]; canRegister: boolean; onStartVisit?(start: VisitStart): void;
}) {
  const list = usePaged<WhoToVisitItem>(
    [ WHO_KEY, micro, reasons ],
    (before) => listWhoToVisit({ micro_area_id: micro, ...(reasons.length > 0 && { reason: reasons }), ...(before && { before }), limit: PAGE }),
    true, true);
  const start = (i: WhoToVisitItem) => onStartVisit?.({
    teamId: team.id, microAreaId: i.micro_area.id, householdId: i.household?.id ?? null, familyId: i.family_id, patientId: i.patient_id, displayName: i.display_name
  });
  const cols: Column<WhoToVisitItem>[] = [
    { label: "Pessoa", w: "1.4fr", card: "title", render: (i) => i.display_name ?? "pessoa sem nome" },
    { label: "Idade", w: "0.6fr", render: (i) => (i.age === null ? "" : `${i.age} anos`) },
    { label: "Endereço", w: "1.6fr", render: (i) => i.household?.address_short ?? "imóvel sem cadastro" },
    { label: "Última visita", w: "1fr", render: (i) => (i.last_visit_on ? fmtDay(i.last_visit_on) : "nunca visitada") },
    { label: "Motivos", w: "2.4fr", render: (i) => <span style={reasonList}>{i.reasons.map((r, n) => <span key={n}>{whoReasonText(r)}</span>)}</span> }
  ];
  if (canRegister) cols.push({ label: "", w: "auto", card: "actions", render: (i) => (
    <button type="button" style={secondaryButtonStyle} aria-label={`Registrar visita para ${i.display_name ?? "esta pessoa"}`} onClick={() => start(i)}>Registrar visita</button>
  ) });
  return (
    <PagedBody list={list}>
      {(items) => <DataTable cols={cols} rows={items} rowKey={(i) => i.patient_id} label="Quem visitar" empty="ninguém para visitar nesta microárea" />}
    </PagedBody>
  );
}
