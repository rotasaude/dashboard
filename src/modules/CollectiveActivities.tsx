// src/modules/CollectiveActivities.tsx
// Tela "Atividade coletiva" (módulo 24b): portão e papel; as opções (`getCollectiveOptions`), a "Nova atividade" (Task 11) e a lista
// com o detalhe (Task 12). Sem equipe visível, a frase e nenhuma leitura (Q57b). Filtros (equipe, período, tipo, "registradas por
// engano") só valem no "Atualizar". A lista não traz pessoa (sem trilha); o detalhe é a leitura nominal, uma vez. Nada em storage;
// na URL só ids, datas e filtros codificados. Uma gravação por vez na tela (`WriteLockProvider`).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCollectiveOptions, listCollectiveActivities, type CollectiveActivitySummary, type CollectiveOptions } from "../lib/api";
import { ACTIVITY_SAVED, CANNOT_REGISTER_ACTIVITY, NO_TEAM, REPLAYED_ACTIVITY } from "../lib/collectiveActivities";
import { CA_LIST_KEY, CA_OPTIONS_KEY, STATIC_QUERY, homeVisitError } from "../lib/homeVisits";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { WriteLockProvider } from "./homeVisits/writeLock";
import { PagedBody, usePaged } from "./HomeVisitsTeam";
import { ActivityForm } from "./collectiveActivities/ActivityForm";
import { ActivityList } from "./collectiveActivities/ActivityList";
import { ActivityDetail } from "./collectiveActivities/ActivityDetail";
import { ActionButton } from "../components/ActionButton";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";

const PERIOD_INVERTED = "o fim do período não pode ser antes do início";

export function CollectiveActivities() {
  return (
    <HomeVisitGate title="Atividade coletiva" sub="atividade coletiva · registrar e consultar" feature={"collective_activities"} allow={(r) => r.professional}>
      {() => <WriteLockProvider><Body /></WriteLockProvider>}
    </HomeVisitGate>
  );
}

function Body() {
  const opts = useQuery({ queryKey: [ CA_OPTIONS_KEY ], queryFn: getCollectiveOptions, ...STATIC_QUERY });
  const [ picked, setPicked ] = useState<string | null>(null);
  if (opts.isError) return <p role="alert" style={alert}>{homeVisitError(opts.error)}</p>;
  if (!opts.data) return <p role="status" style={muted}>Carregando…</p>;
  const teams = opts.data.teams;
  if (teams.length === 0) return <EmptyState title={NO_TEAM} />;
  const team = teams.find((t) => t.id === picked) ?? teams[0];
  return (
    <div style={stack}>
      {teams.length > 1 && (
        <label style={fieldLabel}>
          Equipe da lista
          <select value={team.id} style={inputStyle} onChange={(e) => setPicked(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.ine}</option>)}
          </select>
        </label>
      )}
      <NewActivity options={opts.data} />
      <ActivityPanel key={team.id} options={opts.data} teamId={team.id} />
    </div>
  );
}

function NewActivity({ options }: { options: CollectiveOptions }) {
  // O formulário aberto (fechar o desmonta: nada do anterior sobra) e a frase do último registro.
  const [ open, setOpen ] = useState(false);
  const [ saved, setSaved ] = useState<string | null>(null);
  const queryClient = useQueryClient();
  if (!options.teams.some((t) => t.can_register)) return <p style={muted}>{CANNOT_REGISTER_ACTIVITY}</p>;
  return (
    <div style={stack}>
      {saved && <p role="status" style={okText}>{saved}</p>}
      {open ? (
        <ActivityForm options={options} onClose={() => setOpen(false)}
          onSaved={(r) => {
            setOpen(false); setSaved(r.replayed ? REPLAYED_ACTIVITY : ACTIVITY_SAVED);
            void queryClient.invalidateQueries({ queryKey: [ CA_LIST_KEY ] });
          }} />
      ) : (
        <div>
          <ActionButton onClick={() => { setSaved(null); setOpen(true); }}>Nova atividade</ActionButton>
        </div>
      )}
    </div>
  );
}

interface Filters { from: string; to: string; type: string; mistaken: boolean }

function ActivityPanel({ options, teamId }: { options: CollectiveOptions; teamId: string }) {
  const initial: Filters = { from: `${options.today.slice(0, 7)}-01`, to: options.today, type: "", mistaken: false };
  const [ draft, setDraft ] = useState<Filters>(initial);
  const [ applied, setApplied ] = useState<Filters>(initial);
  const [ openId, setOpenId ] = useState<string | null>(null);
  const inverted = draft.to < draft.from;
  const list = usePaged<CollectiveActivitySummary>(
    [ CA_LIST_KEY, teamId, applied.from, applied.to, applied.type, applied.mistaken ],
    (before) => listCollectiveActivities({
      team_id: teamId, from: applied.from, to: applied.to, ...(applied.type && { activity_type: [ Number(applied.type) ] }),
      // A atividade `mistaken` some por padrão (contrato §7).
      ...(applied.mistaken && { state: [ "recorded", "mistaken" ] }), ...(before && { before }) }),
    false, openId === null);
  if (openId) {
    return (
      <div style={stack}>
        <div><button type="button" style={secondaryButtonStyle} onClick={() => setOpenId(null)}>Voltar à lista</button></div>
        <ActivityDetail key={openId} id={openId} domains={options.domains} />
      </div>
    );
  }
  return (
    <div style={stack}>
      <form style={{ ...row, alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); if (!inverted) setApplied(draft); }}>
        <label style={fieldLabel}>De<input type="date" value={draft.from} style={inputStyle} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
        <label style={fieldLabel}>Até<input type="date" value={draft.to} style={inputStyle} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
        <label style={fieldLabel}>Filtrar por tipo
          <select value={draft.type} style={inputStyle} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="">Todos</option>
            {options.domains.activity_types.map((t) => <option key={t.code} value={String(t.code)}>{t.label}</option>)}
          </select>
        </label>
        <label style={{ ...row, fontSize: 12.5 }}>
          <input type="checkbox" checked={draft.mistaken} onChange={(e) => setDraft({ ...draft, mistaken: e.target.checked })} />
          Mostrar as registradas por engano
        </label>
        <button type="submit" disabled={inverted} style={inverted ? disabledButtonStyle : buttonStyle}>Atualizar</button>
      </form>
      {inverted && <p role="alert" style={alert}>{PERIOD_INVERTED}</p>}
      <PagedBody list={list}>{(items) => <ActivityList activities={items} domains={options.domains} onOpen={(a) => setOpenId(a.id)} />}</PagedBody>
    </div>
  );
}
