// src/modules/billing/ProceduresPanel.tsx
// Procedimentos realizados no atendimento chamado (contrato §3; spec §5.1):
// a lista do atendimento (Divergência B2) e o registro, com a data de hoje.
// Na consulta vão também o id dela e o paciente; no modo integrado, só o
// atendimento (Divergência B1). Lido ao abrir e depois de cada ação; nada
// relê sozinho. O profissional cancela só os próprios (o api confere).
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listProcedures, recordProcedure, type HealthUnit } from "../../lib/api";
import { CARE_PROCEDURES_KEY, billingError, procedureBody, savedText } from "../../lib/billing";
import { todayInCity } from "../../lib/campaigns";
import { useAuth } from "../../lib/auth";
import { buttonStyle } from "../../components/formStyles";
import { alert, muted, panel, row } from "../exams/styles";
import { ProcedureForm } from "./ProcedureForm";
import { ProcedureTable } from "./ProcedureTable";

interface Props {
  unit: HealthUnit;
  attendanceId: string;
  consultationId?: string | null;
  patientId?: string | null;
  today?: string;
  searchDelayMs?: number;
}

export function ProceduresPanel({ unit, attendanceId, consultationId = null, patientId = null, today = todayInCity(), searchDelayMs }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = [ CARE_PROCEDURES_KEY, "attendance", attendanceId ];
  const list = useQuery({ queryKey, queryFn: () => listProcedures({ attendanceId }), gcTime: 0, staleTime: 0, retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false });
  const [ adding, setAdding ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);
  const reload = () => void queryClient.invalidateQueries({ queryKey });

  return (
    <section aria-label="Procedimentos realizados" style={panel}>
      <div style={row}>
        <strong style={{ flex: 1 }}>Procedimentos realizados</strong>
        {!adding && (
          <button type="button" style={buttonStyle} onClick={() => { setNotice(null); setAdding(true); }}>Registrar procedimento</button>
        )}
      </div>
      <p style={muted}>{`${unit.name} · a conferência com a SIGTAP não impede o registro`}</p>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      {list.isPending && <p className="mono" style={muted}>carregando…</p>}
      {list.isError && <p role="alert" style={alert}>{billingError(list.error)}</p>}
      {list.data && (
        <ProcedureTable rows={list.data.procedures} canCancel={(p) => !!user && p.professional.user_id === user.id}
          onChanged={(message) => { setNotice(message); reload(); }} onStale={reload} />
      )}
      {adding && (
        <ProcedureForm today={today} dateEditable={false} searchDelayMs={searchDelayMs}
          submit={(draft) => recordProcedure(procedureBody(draft, {
            establishment: { type: "health_unit", id: unit.id }, patientId, attendanceId, consultationId
          }))}
          onSaved={(p) => { setAdding(false); setNotice(savedText(p)); reload(); }}
          onCancel={() => setAdding(false)} />
      )}
    </section>
  );
}

const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
