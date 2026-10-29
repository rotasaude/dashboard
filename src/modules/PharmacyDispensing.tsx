// PharmacyDispensing — dispensação por receita (módulo 27a; F-27.5; contrato §7, H3). Por local, farmacêutico ou auxiliar:
// busca a receita pelo código ou pelo paciente, mostra os cartões e, em "Dispensar", abre o DispenseForm no lugar dos cartões.
// Depois de uma dispensação a MESMA busca é refeita uma vez (o saldo e o já dispensado mudaram) e a tela diz "Dispensação registrada.";
// a releitura só vale se a pessoa não trocou nem limpou a busca no meio (contador `seq`, como na busca). Receita que mudou enquanto
// se dispensava: o formulário fecha, a lista sai e a frase fica. A lista vive só no estado: nada de useQuery com a receita, nada em
// URL, log ou storage.
import { useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { lookupPrescriptions, type Dispensation, type PharmacyLocation, type PrescriptionLookupInput, type PrescriptionView } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { PRESCRIPTION_CHANGED, pharmacyError } from "../lib/pharmacy";
import { secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, okText, row, stack } from "./exams/styles";
import { DispenseForm } from "./pharmacy/DispenseForm";
import { LocationPick } from "./pharmacy/LocationPick";
import { PatientHistory } from "./pharmacy/PatientHistory";
import { PharmacyGate } from "./pharmacy/PharmacyGate";
import { PrescriptionCard } from "./pharmacy/PrescriptionCard";
import { PrescriptionLookup } from "./pharmacy/PrescriptionLookup";

export const DISPENSED_TEXT = "Dispensação registrada.";
export const NO_PRESCRIPTION_TEXT = "nenhuma receita encontrada";
export const NO_PRESCRIPTION_PATIENT_TEXT = "nenhuma receita deste paciente nos últimos 365 dias";
export const PATIENT_WINDOW_TEXT = "Receitas dos últimos 365 dias (até 20).";
export const REREAD_FAILED_TEXT = "Dispensação registrada, mas não foi possível reler a receita — busque de novo.";

// O encaixe do formulário da dispensação (os testes da tela trocam por um dublê). `onDone` = dispensou; `onStale` = a receita mudou;
// `onCancel` = desistiu.
export interface DispenseSlotProps {
  location: PharmacyLocation; prescription: PrescriptionView; today: string; onDone(d?: Dispensation): void; onStale(): void; onCancel(): void;
}
const defaultSlot = ({ location, prescription, today, onDone, onStale, onCancel }: DispenseSlotProps): ReactNode => (
  <DispenseForm location={location} prescription={prescription} today={today} onDone={onDone} onStale={onStale} onCancel={onCancel} />
);

export function PharmacyDispensing({ today = todayInCity(), renderDispense = defaultSlot }: {
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
  const [ rereading, setRereading ] = useState(false);
  // O paciente cujo histórico de retiradas está aberto: o painel só nasce no clique (cada abertura é uma leitura nominal com trilha).
  const [ historyOf, setHistoryOf ] = useState<string | null>(null);
  // Só a busca (ou a releitura) mais recente vale: `clear` e `onFound` incrementam; a resposta de uma releitura que ficou para trás é ignorada.
  const seq = useRef(0);
  // O `seq` de quando o formulário abriu: se mudou (busca nova ou limpa durante o envio), a resposta da dispensação não refaz a busca antiga.
  const opened = useRef(0);
  // A nova leitura da MESMA busca, uma vez, depois de dispensar (mutação: grava trilha, sem cache nem releitura sozinha).
  const reread = useMutation({ mutationFn: (input: PrescriptionLookupInput) => lookupPrescriptions(input), gcTime: 0 });

  const clear = () => { seq.current += 1; setRereading(false); setFound(null); setDispensing(null); setNotice(null); setProblem(null); setHistoryOf(null); };

  function dispensed(input: PrescriptionLookupInput, patientId: string | null) {
    const mine = seq.current;
    setDispensing(null);
    setNotice(DISPENSED_TEXT);
    setProblem(null);
    setRereading(true);
    reread.mutate(input, {
      onSuccess: (list) => { if (mine === seq.current) { setRereading(false); setFound({ list, patientId, input }); } },
      onError: (err) => {
        if (mine !== seq.current) return;
        setRereading(false); setFound(null); setNotice(null); setProblem(`${REREAD_FAILED_TEXT} (${pharmacyError(err)})`);
      }
    });
  }

  // A receita mudou (cancelada, vencida, sumiu): fecha o formulário, tira a lista velha e deixa a frase; a pessoa busca de novo.
  function stale() { if (opened.current !== seq.current) return; clear(); setProblem(PRESCRIPTION_CHANGED); }
  // Dispensou: se a busca já foi trocada, só o aviso fica (a lista nova não é da receita dispensada).
  function done(input: PrescriptionLookupInput, patientId: string | null) {
    if (opened.current !== seq.current) { setNotice(DISPENSED_TEXT); return; }
    dispensed(input, patientId);
  }

  const open = found?.list.find((p) => p.id === dispensing) ?? null;
  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      <PrescriptionLookup location={location} today={today} onClear={clear}
        onFound={(list, patientId, input) => {
          seq.current += 1; setRereading(false); setDispensing(null); setNotice(null); setProblem(null); setHistoryOf(null); setFound({ list, patientId, input });
        }} />
      {notice && <p role="status" style={okText}>{notice}</p>}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {rereading && <p className="mono" style={muted}>relendo a receita…</p>}
      {found && !rereading && found.list.length === 0 && <p style={muted}>{found.patientId ? NO_PRESCRIPTION_PATIENT_TEXT : NO_PRESCRIPTION_TEXT}</p>}
      {found && !rereading && found.list.length > 0 && found.patientId && <p style={muted}>{PATIENT_WINDOW_TEXT}</p>}
      {/* Busca por paciente: um botão só, do paciente escolhido; busca pelo código: o botão fica no cartão (paciente da receita). */}
      {found?.patientId && !open && (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} onClick={() => setHistoryOf(found.patientId)}>Histórico de retiradas</button>
        </div>
      )}
      {!rereading && !open && found?.list.map((p) => (
        <PrescriptionCard key={`${p.kind}-${p.id}`} p={p} onDispense={() => { setNotice(null); setHistoryOf(null); opened.current = seq.current; setDispensing(p.id); }}
          onHistory={found.patientId ? undefined : () => setHistoryOf(p.patient.id)} />
      ))}
      {historyOf && !open && (
        <div style={stack}>
          <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => setHistoryOf(null)}>Fechar histórico</button></div>
          <PatientHistory key={historyOf} patientId={historyOf} />
        </div>
      )}
      {!rereading && found && open && renderDispense({
        location, prescription: open, today, onDone: () => done(found.input, found.patientId), onStale: stale, onCancel: () => setDispensing(null)
      })}
    </div>
  );
}
