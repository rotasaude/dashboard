// PharmacyDispensing — dispensação por receita (módulo 27a; F-27.5; contrato §7, H3). Por local, farmacêutico ou auxiliar:
// busca a receita pelo código ou pelo paciente, mostra os cartões e, em "Dispensar", abre o formulário da dispensação (Task 10;
// aqui o encaixe é provisório). Depois de uma dispensação a MESMA busca é refeita uma vez (o saldo e o já dispensado mudaram)
// e a tela diz "Dispensação registrada.". A lista vive só no estado: nada de useQuery com a receita, nada em URL, log ou storage.
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { lookupPrescriptions, type PharmacyLocation, type PrescriptionLookupInput, type PrescriptionView } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { pharmacyError } from "../lib/pharmacy";
import { EmptyState } from "../components/EmptyState";
import { secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, okText, row, stack } from "./exams/styles";
import { LocationPick } from "./pharmacy/LocationPick";
import { PharmacyGate } from "./pharmacy/PharmacyGate";
import { PrescriptionCard } from "./pharmacy/PrescriptionCard";
import { PrescriptionLookup } from "./pharmacy/PrescriptionLookup";

export const DISPENSED_TEXT = "Dispensação registrada.";
export const NO_PRESCRIPTION_TEXT = "nenhuma receita encontrada";
export const NO_PRESCRIPTION_PATIENT_TEXT = "nenhuma receita deste paciente nos últimos 365 dias";
export const PATIENT_WINDOW_TEXT = "Receitas dos últimos 365 dias (até 20).";
export const REREAD_FAILED_TEXT = "Dispensação registrada, mas não foi possível reler a receita — busque de novo.";

// O encaixe do formulário da dispensação: a Task 10 troca o provisório. `onDone` = dispensou; `onCancel` = desistiu.
export interface DispenseSlotProps { location: PharmacyLocation; prescription: PrescriptionView; onDone(): void; onCancel(): void }
const provisionalSlot = ({ onCancel }: DispenseSlotProps): ReactNode => (
  <div style={stack}>
    <EmptyState title="Dispensação em construção" />
    <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button></div>
  </div>
);

export function PharmacyDispensing({ today = todayInCity(), renderDispense = provisionalSlot }: {
  today?: string; renderDispense?(props: DispenseSlotProps): ReactNode;
} = {}) {
  return (
    <PharmacyGate title="Dispensação" sub="receita pelo código ou pelo paciente, lote e retirada" allow={(r) => r.pharmacist || r.assistant}>
      {() => (
        <LocationPick allow={(r) => r.pharmacist || r.assistant}>
          {(loc) => <Body location={loc} today={today} renderDispense={renderDispense} />}
        </LocationPick>
      )}
    </PharmacyGate>
  );
}

interface Found { list: PrescriptionView[]; patientId: string | null; input: PrescriptionLookupInput }

function Body({ location, today, renderDispense }: { location: PharmacyLocation; today: string; renderDispense(props: DispenseSlotProps): ReactNode }) {
  const [ found, setFound ] = useState<Found | null>(null);
  const [ dispensing, setDispensing ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  // A nova leitura da MESMA busca, uma vez, depois de dispensar (mutação: grava trilha, sem cache nem releitura sozinha).
  const reread = useMutation({ mutationFn: (input: PrescriptionLookupInput) => lookupPrescriptions(input), gcTime: 0 });

  const clear = () => { setFound(null); setDispensing(null); setNotice(null); setProblem(null); };

  function dispensed(input: PrescriptionLookupInput, patientId: string | null) {
    setDispensing(null);
    setNotice(DISPENSED_TEXT);
    setProblem(null);
    reread.mutate(input, {
      onSuccess: (list) => setFound({ list, patientId, input }),
      onError: (err) => { setFound(null); setNotice(null); setProblem(`${REREAD_FAILED_TEXT} (${pharmacyError(err)})`); }
    });
  }

  const open = found?.list.find((p) => p.id === dispensing) ?? null;
  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      <PrescriptionLookup location={location} today={today} onClear={clear}
        onFound={(list, patientId, input) => { setDispensing(null); setNotice(null); setProblem(null); setFound({ list, patientId, input }); }} />
      {notice && <p role="status" style={okText}>{notice}</p>}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {reread.isPending && <p className="mono" style={muted}>relendo a receita…</p>}
      {found && found.list.length === 0 && <p style={muted}>{found.patientId ? NO_PRESCRIPTION_PATIENT_TEXT : NO_PRESCRIPTION_TEXT}</p>}
      {found && found.list.length > 0 && found.patientId && <p style={muted}>{PATIENT_WINDOW_TEXT}</p>}
      {found?.list.map((p) => <PrescriptionCard key={`${p.kind}-${p.id}`} p={p} onDispense={() => { setNotice(null); setDispensing(p.id); }} />)}
      {found && open && renderDispense({ location, prescription: open, onDone: () => dispensed(found.input, found.patientId), onCancel: () => setDispensing(null) })}
    </div>
  );
}
