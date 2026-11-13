// src/modules/CollectiveActivities.tsx
// Tela "Atividade coletiva" (módulo 24b): portão e papel; as opções (`getCollectiveOptions`) e a "Nova atividade" (Task 11).
// Sem equipe visível, a frase e nenhum formulário (Q57b). Uma gravação por vez na tela (`WriteLockProvider`). A lista e o
// detalhe vêm na Task 12.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCollectiveOptions, type CollectiveOptions } from "../lib/api";
import { ACTIVITY_SAVED, CANNOT_REGISTER_ACTIVITY, NO_TEAM, REPLAYED_ACTIVITY } from "../lib/collectiveActivities";
import { CA_OPTIONS_KEY, STATIC_QUERY, homeVisitError } from "../lib/homeVisits";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { WriteLockProvider } from "./homeVisits/writeLock";
import { ActivityForm } from "./collectiveActivities/ActivityForm";
import { ActionButton } from "../components/ActionButton";
import { EmptyState } from "../components/EmptyState";
import { alert, muted, okText, stack } from "./exams/styles";

export function CollectiveActivities() {
  return (
    <HomeVisitGate title="Atividade coletiva" sub="atividade coletiva · registrar e consultar" feature={"collective_activities"} allow={(r) => r.professional}>
      {() => <WriteLockProvider><Body /></WriteLockProvider>}
    </HomeVisitGate>
  );
}

function Body() {
  const opts = useQuery({ queryKey: [ CA_OPTIONS_KEY ], queryFn: getCollectiveOptions, ...STATIC_QUERY });
  if (opts.isError) return <p role="alert" style={alert}>{homeVisitError(opts.error)}</p>;
  if (!opts.data) return <p role="status" style={muted}>Carregando…</p>;
  if (opts.data.teams.length === 0) return <EmptyState title={NO_TEAM} />;
  return <NewActivity options={opts.data} />;
}

function NewActivity({ options }: { options: CollectiveOptions }) {
  // O formulário aberto (fechar o desmonta: nada do anterior sobra) e a frase do último registro.
  const [ open, setOpen ] = useState(false);
  const [ saved, setSaved ] = useState<string | null>(null);
  if (!options.teams.some((t) => t.can_register)) return <EmptyState title={CANNOT_REGISTER_ACTIVITY} />;
  return (
    <div style={stack}>
      {saved && <p role="status" style={okText}>{saved}</p>}
      {open ? (
        <ActivityForm options={options} onClose={() => setOpen(false)}
          onSaved={(r) => { setOpen(false); setSaved(r.replayed ? REPLAYED_ACTIVITY : ACTIVITY_SAVED); }} />
      ) : (
        <div>
          <ActionButton onClick={() => { setSaved(null); setOpen(true); }}>Nova atividade</ActionButton>
        </div>
      )}
    </div>
  );
}
