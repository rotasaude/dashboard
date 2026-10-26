// src/modules/RegistryStatus.tsx
// Validade dos cadastros (módulo 24a, F-24.6; contrato §6, L10, L12, L19, L24):
// cadastro vencido (24 meses ou mais), a vencer em até 60 dias, sem
// identificador, recusado e quem falta cadastrar, por equipe e microárea.
// A lista é NOMINAL e GRAVA trilha (uma por pessoa mostrada): lida ao abrir,
// ao trocar de aba ou de filtro e em "Carregar mais", nunca sozinha
// (NOMINAL_QUERY). Só a contagem (/count, sem trilha) relê por minuto.
// Escopo (preflight C17/C18; L27): o ACS só lê a microárea dele (sem ela o api
// responde 403, na lista e na contagem); "todas as microáreas" só aparece
// quando o api diz que o profissional lê a equipe toda (`reads_whole_team`,
// a regra do próprio registry_status), mesmo com uma microárea só; o ACS
// de todas as microáreas continua preso à primeira. Com microárea escolhida a
// população é só quem tem cadastro nela: "sem cadastro" vem sempre vazio,
// então a aba sai e a tela explica.
// "Cadastrar"/"Atualizar" abrem a ficha individual nesta tela (Task 12):
// quem tem cadastro, pelo cadastro; paciente ou par validado sem cadastro,
// pela pessoa, com a equipe escolhida — sem domicílio, a ficha vai fora de
// área (team_id, A11). Salvar relê a lista e os números uma vez.
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { countRegistryStatus, getTerritoryContext, listRegistryStatus, type PersonRow, type RegistryListStatus } from "../lib/api";
import {
  COUNT_QUERY, IDENTITY_REVIEW_TEXT, NOMINAL_QUERY, NO_NAME, REGISTRY_COUNT_KEY, REGISTRY_STATUS_KEY, STATIC_QUERY, TERRITORY_CONTEXT_KEY, fmtDay,
  registryStatusLabel, registryStatusTone, teamName, territoryError
} from "../lib/territoryRegistry";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { DataTable, type Column } from "../components/DataTable";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { Tag } from "../components/Tag";
import { SegmentedControl } from "../shell/SegmentedControl";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";
import { TerritoryGate } from "./territory/TerritoryGate";
import { REGISTRATION_EXITED, REGISTRATION_SAVED, RegistrationForm } from "./territory/RegistrationForm";
import type { PersonChoice } from "./territory/PersonStart";
import { Reveal } from "./territory/Reveal";

export const MISSING_NEEDS_TEAM = "Com uma microárea escolhida, a lista e os números são só de quem tem cadastro nela — quem ainda não tem cadastro não tem microárea.";

type Tab = Exclude<RegistryListStatus, "valid">;
const TABS: { key: Tab; label: string; count?: "expired" | "due_soon" | "missing_identifier" | "missing" }[] = [
  { key: "expired", label: "Vencidos", count: "expired" },
  { key: "due_soon", label: "A vencer", count: "due_soon" },
  { key: "missing_identifier", label: "Sem identificador", count: "missing_identifier" },
  { key: "missing", label: "Sem cadastro", count: "missing" },
  { key: "refused", label: "Recusou" }
];
const TAB_SUB: Record<Tab, string> = {
  expired: "último cadastro há 24 meses ou mais",
  due_soon: "o cadastro vence em até 60 dias",
  missing_identifier: "cadastro sem CPF e sem CNS — a ficha não chega ao e-SUS",
  missing: "pessoas da equipe sem cadastro individual",
  refused: "cidadão recusou o cadastro"
};
const EMPTY: Record<Tab, string> = {
  expired: "nenhum cadastro vencido", due_soon: "nenhum cadastro vence nos próximos 60 dias",
  missing_identifier: "nenhum cadastro sem identificador", missing: "ninguém da equipe sem cadastro", refused: "nenhuma recusa"
};

// A pessoa da linha na ficha: o cadastro (atualizar) ou a pessoa (cadastrar).
type Opening = { key: string; name: string; teamId: string; registrationId?: string; choice?: PersonChoice };
function opening(p: PersonRow, teamId: string, name: string): Opening | null {
  const key = p.patient_id ?? p.citizen_id;
  if (!key) return null;
  if (p.registration_id) return { key, name, teamId, registrationId: p.registration_id };
  const choice: PersonChoice = p.patient_id
    ? { kind: "patient", patientId: p.patient_id, registrationId: null, displayName: p.display_name }
    : { kind: "citizen", citizenId: key, displayName: p.display_name };
  return { key, name, teamId, choice };
}

export function RegistryStatus({ today }: { today?: string } = {}) {
  return (
    <TerritoryGate title="Validade dos cadastros" sub="cadastro territorial · vencidos, a vencer e quem falta cadastrar" allow={(r) => r.professional}>
      {() => <StatusBody today={today} />}
    </TerritoryGate>
  );
}

function StatusBody({ today }: { today?: string }) {
  const context = useQuery({ queryKey: [ TERRITORY_CONTEXT_KEY ], queryFn: getTerritoryContext, ...STATIC_QUERY });
  const [ teamChoice, setTeamChoice ] = useState("");
  // null = ainda não escolhida (vale o padrão da equipe); "" = todas as microáreas.
  const [ areaChoice, setAreaChoice ] = useState<string | null>(null);
  const [ tabChoice, setTabChoice ] = useState<Tab>("expired");
  const [ open, setOpen ] = useState<Opening | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  const teams = (context.data?.teams ?? []).map((t) => {
    const areas = t.micro_areas.filter((m) => m.can_register);
    return { ...t, areas, teamWide: t.reads_whole_team === true };
  }).filter((t) => t.areas.length > 0);
  const team = teams.find((t) => t.id === teamChoice) ?? teams[0];
  const teamId = team?.id ?? "";
  const defaultArea = team ? (team.teamWide ? "" : team.areas[0].id) : "";
  const areaId = areaChoice !== null && (areaChoice === "" ? team?.teamWide : team?.areas.some((m) => m.id === areaChoice))
    ? areaChoice : defaultArea;
  const microAreaId = areaId || undefined;
  const tab: Tab = tabChoice === "missing" && microAreaId ? "expired" : tabChoice;

  const counts = useQuery({
    queryKey: [ REGISTRY_COUNT_KEY, teamId, areaId ], queryFn: () => countRegistryStatus(teamId, microAreaId),
    enabled: !!teamId, ...COUNT_QUERY
  });
  const query = useInfiniteQuery({
    queryKey: [ REGISTRY_STATUS_KEY, teamId, areaId, tab ],
    queryFn: ({ pageParam }) => listRegistryStatus({ teamId, microAreaId, status: tab, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: !!teamId,
    ...NOMINAL_QUERY
  });

  if (context.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (context.isError) return <p role="alert" style={alert}>{territoryError(context.error)}</p>;
  if (!team) return <EmptyState title="nenhuma microárea em que você cadastre nas suas equipes" />;

  const c = counts.data;
  const tabs = TABS.filter((t) => t.key !== "missing" || !microAreaId)
    .map((t) => ({ key: t.key, label: t.count && c ? `${t.label} (${c[t.count]})` : t.label }));
  const rows = (query.data?.pages ?? []).flatMap((p) => p.people);
  const nameOf = (p: PersonRow) => p.display_name ?? NO_NAME;
  const cols: Column<PersonRow>[] = [
    { label: "Nome", w: "2fr", card: "title", render: nameOf },
    { label: "Idade", w: "90px", render: (p) => (p.age === null ? "—" : `${p.age} ${p.age === 1 ? "ano" : "anos"}`) },
    { label: "Microárea", w: "90px", render: (p) => p.micro_area_code ?? "—" },
    { label: "Último cadastro", w: "130px", render: (p) => fmtDay(p.registered_at) },
    {
      label: "Situação", w: "1.4fr",
      render: (p) => (
        <span style={row}>
          <Tag tone={registryStatusTone(p.status)}>{registryStatusLabel(p.status)}</Tag>
          {p.identity_review_pending && <Tag tone="warn">{IDENTITY_REVIEW_TEXT}</Tag>}
        </span>
      )
    }
  ];
  cols.push({
    label: "Ação", w: "110px", card: "actions",
    render: (p) => {
      const verb = p.status === "missing" ? "Cadastrar" : "Atualizar";
      const next = opening(p, teamId, nameOf(p));
      return next && (
        <button type="button" style={secondaryButtonStyle} aria-label={`${verb} ${nameOf(p)}`} onClick={() => { setNotice(null); setOpen(next); }}>{verb}</button>
      );
    }
  });

  return (
    <div style={stack}>
      <Panel title="Equipe e microárea">
        <div style={{ ...stack, padding: 16 }}>
          <div style={{ ...row, alignItems: "flex-end" }}>
            {teams.length > 1 && (
              <label style={fieldLabel}>
                Equipe
                <select value={team.id} style={inputStyle} onChange={(e) => { setAreaChoice(null); setTeamChoice(e.target.value); }}>
                  {teams.map((t) => <option key={t.id} value={t.id}>{`${teamName(t)} · INE ${t.ine} · ${t.unit.name}`}</option>)}
                </select>
              </label>
            )}
            <label style={fieldLabel}>
              Microárea
              <select value={areaId} style={inputStyle} onChange={(e) => setAreaChoice(e.target.value)}>
                {team.teamWide && <option value="">todas as microáreas</option>}
                {team.areas.map((m) => <option key={m.id} value={m.id}>{`${m.code} · ${m.name}`}</option>)}
              </select>
            </label>
          </div>
          {microAreaId && (
            <p style={muted}>
              {MISSING_NEEDS_TEAM}{" "}
              {team.teamWide ? "Para ver quem falta cadastrar, escolha “todas as microáreas”." : "Quem falta cadastrar aparece na visão da equipe toda, do enfermeiro ou do médico da equipe."}
            </p>
          )}
        </div>
      </Panel>
      {counts.isError && <p role="alert" style={alert}>{territoryError(counts.error)}</p>}
      <KpiGrid min={150}>
        <StatTile label="Válidos" value={c?.valid} tone="ok" />
        <StatTile label="Vencem em até 60 dias" value={c?.due_soon} tone="warn" />
        <StatTile label="Vencidos (24 meses ou mais)" value={c?.expired} tone="down" />
        <StatTile label="Sem identificador (CPF ou CNS)" value={c?.missing_identifier} tone="warn" />
        <StatTile label="Sem cadastro" value={microAreaId ? "—" : c?.missing} tone="down" hint={microAreaId ? "só na equipe toda" : undefined} />
      </KpiGrid>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {open && (
        <Reveal key={open.key}>
          <Panel title="Cadastro individual" sub={open.name}>
            <div style={{ padding: 16 }}>
              <RegistrationForm today={today} teamId={open.teamId} registrationId={open.registrationId} choice={open.choice}
                onCancel={() => setOpen(null)} onSaved={() => { setOpen(null); setNotice(REGISTRATION_SAVED); }}
                onExited={() => { setOpen(null); setNotice(REGISTRATION_EXITED); }} />
            </div>
          </Panel>
        </Reveal>
      )}
      <SegmentedControl<Tab> options={tabs} value={tab} onChange={setTabChoice} />
      <Panel title="Pessoas" sub={TAB_SUB[tab]}>
        <div style={{ ...stack, padding: 16 }}>
          {query.isPending && <p className="mono" style={muted}>carregando…</p>}
          {query.isError && <p role="alert" style={alert}>{territoryError(query.error)}</p>}
          {query.data && <DataTable<PersonRow> cols={cols} rows={rows} rowKey={(p) => p.patient_id ?? p.citizen_id ?? ""} empty={EMPTY[tab]} />}
          {query.hasNextPage && (
            <div>
              <button type="button" style={secondaryButtonStyle} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                Carregar mais
              </button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
