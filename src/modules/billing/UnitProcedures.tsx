// Procedimento avulso pela unidade (spec §5.1): fora de atendimento, para um
// paciente achado pelo CPF. Só em unidade que fatura BPA (quem chama confere
// `showUnitProcedures`). A lista é a dos procedimentos do próprio profissional
// para o paciente (contrato §3: profissional só os próprios por patient_id).
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listProcedures, recordProcedure, type BillingPatient, type HealthUnit } from "../../lib/api";
import { CARE_PROCEDURES_KEY, billingError, procedureBody, savedText } from "../../lib/billing";
import { todayInCity } from "../../lib/campaigns";
import { useAuth } from "../../lib/auth";
import { Panel } from "../../components/Panel";
import { buttonStyle } from "../../components/formStyles";
import { alert, muted, stack } from "../exams/styles";
import { BillingPatientLookup } from "./BillingPatientLookup";
import { ProcedureForm } from "./ProcedureForm";
import { ProcedureTable } from "./ProcedureTable";

export function UnitProcedures({ unit, today = todayInCity(), searchDelayMs }: { unit: HealthUnit; today?: string; searchDelayMs?: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ patient, setPatient ] = useState<BillingPatient | null>(null);
  const [ adding, setAdding ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);
  const queryKey = [ CARE_PROCEDURES_KEY, "patient", patient?.id ?? null ];
  const list = useQuery({
    queryKey, queryFn: () => listProcedures({ patientId: patient!.id }), enabled: !!patient, gcTime: 0, staleTime: 0, retry: false,
    refetchOnReconnect: false, refetchOnWindowFocus: false
  });
  const reload = () => void queryClient.invalidateQueries({ queryKey });

  // O Panel é a região "Procedimento avulso" (aria-label = título).
  return (
    <Panel title="Procedimento avulso" sub={`fora do atendimento · ${unit.name}`}>
      <div style={{ ...stack, padding: 16 }}>
        <BillingPatientLookup patient={patient} onFound={(p) => { setPatient(p); setAdding(false); setNotice(null); }} />
        {notice && <p role="status" style={statusStyle}>{notice}</p>}
        {patient && list.isPending && <p className="mono" style={muted}>carregando…</p>}
        {patient && list.isError && <p role="alert" style={alert}>{billingError(list.error)}</p>}
        {patient && list.data && (
          <ProcedureTable rows={list.data.procedures} canCancel={(p) => !!user && p.professional.user_id === user.id}
            onChanged={(message) => { setNotice(message); reload(); }} onStale={reload} />
        )}
        {patient && !adding && (
          <div><button type="button" style={buttonStyle} onClick={() => { setNotice(null); setAdding(true); }}>Registrar procedimento</button></div>
        )}
        {patient && adding && (
          <ProcedureForm today={today} dateEditable searchDelayMs={searchDelayMs}
            submit={(draft) => recordProcedure(procedureBody(draft, { establishment: { type: "health_unit", id: unit.id }, patientId: patient.id }))}
            onSaved={(p) => { setAdding(false); setNotice(savedText(p)); reload(); }}
            onCancel={() => setAdding(false)} />
        )}
      </div>
    </Panel>
  );
}

const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
