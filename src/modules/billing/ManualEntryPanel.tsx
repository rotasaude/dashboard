// src/modules/billing/ManualEntryPanel.tsx
// Lançamento manual pelo faturista (spec §5.3; Divergência B5): produção feita
// fora do sistema, com o estabelecimento, o paciente (CPF no corpo), o
// profissional com vínculo e o CBO escolhidos; mesma crítica SIGTAP.
// Profissional sem CBO no vínculo segue: a crítica marca missing_professional_cbo.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listBillingProfessionals, recordProcedure, type BillingEstablishment, type BillingPatient, type PerformedProcedure } from "../../lib/api";
import {
  PROFESSIONALS_KEY, billingError, establishmentKey, establishmentLabel, manualProblem, parseEstablishmentKey, procedureBody, savedText
} from "../../lib/billing";
import { buttonStyle, inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, panel } from "../exams/styles";
import { BillingPatientLookup } from "./BillingPatientLookup";
import { ProcedureForm } from "./ProcedureForm";

interface PanelProps {
  establishments: BillingEstablishment[];
  today: string;
  searchDelayMs?: number;
  onSaved(p: PerformedProcedure): void;
  onClose(): void;
}

export function ManualEntryPanel({ establishments, today, searchDelayMs, onSaved, onClose }: PanelProps) {
  const [ estKey, setEstKey ] = useState("");
  const [ patient, setPatient ] = useState<BillingPatient | null>(null);
  const [ professionalId, setProfessionalId ] = useState("");
  const [ cbo, setCbo ] = useState("");
  const est = parseEstablishmentKey(estKey);
  const professionals = useQuery({
    queryKey: [ PROFESSIONALS_KEY, estKey ], queryFn: () => listBillingProfessionals(est!), enabled: !!est, retry: false,
    // Como as demais leituras do faturamento: nada relê sozinho.
    gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false
  });
  const professional = professionals.data?.find((p) => p.user_id === professionalId) ?? null;
  const cboOptions = professional?.cbo_codes ?? [];
  const chosenCbo = cboOptions.length === 1 ? cboOptions[0] : cbo;
  const problem = manualProblem({ establishment: estKey, patientId: patient?.id ?? null, professionalId, cboOptions, cbo: chosenCbo });

  const before = (
    <>
      <label style={fieldLabel}>
        Estabelecimento
        <select value={estKey} style={inputStyle} onChange={(e) => { setEstKey(e.target.value); setProfessionalId(""); setCbo(""); }}>
          <option value="">escolha o estabelecimento</option>
          {establishments.map((e) => <option key={establishmentKey(e)} value={establishmentKey(e)}>{establishmentLabel(e)}</option>)}
        </select>
      </label>
      <BillingPatientLookup patient={patient} onFound={setPatient} />
      {est && (
        <label style={fieldLabel}>
          Profissional
          <select value={professionalId} style={inputStyle} onChange={(e) => { setProfessionalId(e.target.value); setCbo(""); }}>
            <option value="">escolha o profissional</option>
            {(professionals.data ?? []).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {professionals.isError && <p role="alert" style={alert}>{billingError(professionals.error)}</p>}
      {professional && cboOptions.length > 1 && (
        <label style={fieldLabel}>
          CBO
          <select value={cbo} style={inputStyle} onChange={(e) => setCbo(e.target.value)}>
            <option value="">escolha o CBO</option>
            {cboOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      {professional && cboOptions.length === 1 && <p style={muted}>{`CBO ${cboOptions[0]}`}</p>}
      {professional && cboOptions.length === 0 && (
        <p style={muted}>profissional sem CBO no vínculo — o procedimento fica não faturável até a administração corrigir em Equipe → Profissionais</p>
      )}
    </>
  );

  return (
    <section aria-label="Lançamento manual" style={panel}>
      <strong>Lançamento manual</strong>
      <p style={muted}>Produção feita fora do sistema. Passa pela mesma conferência com a SIGTAP e não impede o registro.</p>
      <ProcedureForm today={today} dateEditable searchDelayMs={searchDelayMs} before={before} beforeProblem={problem}
        submit={(draft) => recordProcedure(procedureBody(draft, {
          establishment: est!, patientId: patient!.id, professionalUserId: professionalId, cboCode: chosenCbo || null
        }))}
        onSaved={onSaved} onCancel={onClose} />
    </section>
  );
}

export function ManualEntrySection({ establishments, today, searchDelayMs, onSaved }: {
  establishments: BillingEstablishment[]; today: string; searchDelayMs?: number; onSaved(message: string): void;
}) {
  const [ open, setOpen ] = useState(false);
  if (!open) {
    return <div><button type="button" style={buttonStyle} onClick={() => setOpen(true)}>Lançamento manual</button></div>;
  }
  return (
    <ManualEntryPanel establishments={establishments} today={today} searchDelayMs={searchDelayMs}
      onSaved={(p) => { setOpen(false); onSaved(savedText(p)); }} onClose={() => setOpen(false)} />
  );
}
