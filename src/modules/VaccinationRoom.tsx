// Sala de vacina (módulo 29; F-29.2): portão → sala onde a pessoa vacina → busca do cidadão → caderneta. A caderneta é leitura
// nominal com trilha: lida por MUTAÇÃO no clique (`gcTime: 0`), nunca sozinha nem em cache; uma resposta de uma busca já trocada
// (outro cidadão, outra sala) é ignorada (`seq`). O catálogo é sem pessoa (STATIC_QUERY). "Outro cidadão" limpa tudo.
// Registrar (F-29.3): o DoseForm toma o lugar da caderneta; depois do 201 a caderneta é relida (mutação) e a frase do aprazamento
// (`doseSavedText`, da caderneta relida) recebe o foco. Transcrever (F-29.3) troca a caderneta pela da resposta (sem nova leitura);
// cancelar (com ou sem substituição) relê a caderneta e diz "Dose cancelada." / "Dose cancelada e substituída.". Respostas que chegam
// depois de trocar de cidadão são descartadas (`seq` e a guarda de paciente em `replaceCard`).
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorCode, getVaccinationCard, getVaccinationCatalog, type CardItem, type CardRequest, type Immunization, type VaccinationCard, type VaccineLocation
} from "../lib/api";
import { cityIsoDate } from "../lib/format";
import { PH_POSITIONS_KEY } from "../lib/pharmacy";
import {
  DOSE_CANCELLED, DOSE_REPLACED, DOSE_SAVED, STATIC_QUERY, TRANSCRIPTION_SAVED, VAC_CATALOG_KEY, VAC_VIALS_KEY, doseSavedText, vaccinationError
} from "../lib/vaccination";
import { secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, panel, row, stack, title } from "./exams/styles";
import { VaccinationGate } from "./vaccination/VaccinationGate";
import { VaccineLocationPick } from "./vaccination/VaccineLocationPick";
import { PatientPick } from "./vaccination/PatientPick";
import { CardView } from "./vaccination/CardView";
import { DoseForm } from "./vaccination/DoseForm";
import { TranscriptionForm } from "./vaccination/TranscriptionForm";
import { CancelDose, type CancelResult } from "./vaccination/CancelDose";
import type { PersonRestart } from "./territory/PersonStart";

// `now` só para testes: sem ele, cada tela lê o relógio na hora (um padrão aqui congelaria a hora da abertura da sala).
export function VaccinationRoom({ now, onGoToSecurity }: { now?: Date; onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Sala de vacina" sub="caderneta, dose com lote e frasco, transcrição" allow={(r) => r.professional}>
      {() => (
        <VaccineLocationPick allow={(a, loc) => a.vaccinate && loc.kind === "vaccine_room" && !!loc.room_id}>
          {(room) => <RoomBody room={room} now={now} onGoToSecurity={onGoToSecurity} />}
        </VaccineLocationPick>
      )}
    </VaccinationGate>
  );
}

function RoomBody({ room, now: fixedNow, onGoToSecurity }: { room: VaccineLocation; now?: Date; onGoToSecurity?(): void }) {
  const roomId = room.room_id as string;
  const client = useQueryClient();
  const now = fixedNow ?? new Date();
  const today = cityIsoDate(now);
  const catalog = useQuery({ queryKey: [ VAC_CATALOG_KEY ], queryFn: getVaccinationCatalog, ...STATIC_QUERY });
  const [ card, setCard ] = useState<VaccinationCard | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  // A busca remonta (round) em "Outro cidadão" e na volta do 409 duplicate_suspected (restart).
  const [ search, setSearch ] = useState<{ round: number; restart?: PersonRestart }>({ round: 0 });
  const seq = useRef(0);
  const read = useMutation({ gcTime: 0, mutationFn: (req: CardRequest) => getVaccinationCard(roomId, req) });
  const reread = useMutation({ gcTime: 0, mutationFn: (patientId: string) => getVaccinationCard(roomId, { patient_id: patientId }) });
  // O que toma o lugar da caderneta: o registro da dose (item ou "Outra vacina"), a transcrição ou o cancelamento de uma dose.
  const [ view, setView ] = useState<{ kind: "dose"; item: CardItem | null } | { kind: "transcribe" } | { kind: "cancel"; imm: Immunization } | null>(null);
  // A frase depois de uma ação. `redo`: como refazer a frase se a releitura falhar e for repetida ("Reabrir a caderneta").
  type Redo = { after(c: VaccinationCard): string; fallback: string };
  const [ saved, setSaved ] = useState<{ text: string; problem: string | null; redo: Redo | null } | null>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (saved) savedRef.current?.focus(); }, [ saved ]);

  function open(req: CardRequest) {
    if (read.isPending) return;
    const mine = ++seq.current;
    setProblem(null);
    read.mutate(req, {
      onSuccess: (c) => { if (mine === seq.current) setCard(c); },
      onError: (err) => {
        if (mine !== seq.current) return;
        // 24a L28: nome e nascimento de um paciente existente — de volta à busca de duplicados, já feita, com a frase.
        if (errorCode(err) === "duplicate_suspected" && "new_patient" in req) {
          const np = req.new_patient;
          setSearch((s) => ({ round: s.round + 1, restart: {
            query: { full_name: np.full_name, birth_date: np.birth_date, ...(np.mother_name ? { mother_name: np.mother_name } : {}) },
            ...(np.cpf ? { cpf: np.cpf } : {}), search: true } }));
          return;
        }
        setProblem(vaccinationError(err));
      }
    });
  }

  // Releitura vinda de uma ação na caderneta: só vale para a pessoa que está aberta (resposta atrasada de outra é descartada).
  const replaceCard = (c: VaccinationCard) => setCard((cur) => (cur && cur.patient.id === c.patient.id ? c : cur));

  // Desistiu da busca: a caderneta que ainda esteja chegando é descartada.
  function drop() {
    seq.current += 1;
    read.reset();
    setProblem(null);
  }

  function show(next: typeof view) {
    setSaved(null);
    setView(next);
  }

  // A dose debita a posição e pode gastar frasco: a próxima leitura de estoque e de frascos da sala vem fresca.
  function refreshStock() {
    void client.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY, room.id ] });
    void client.invalidateQueries({ queryKey: [ VAC_VIALS_KEY, roomId ] });
  }

  function onSaved(imm: Immunization) {
    setView(null);
    refreshStock();
    const code = imm.immunobiological.code;
    rereadCard({ after: (c) => doseSavedText(c, code, catalog.data), fallback: DOSE_SAVED });
  }

  function onCancelled(res: CancelResult) {
    setView(null);
    if (res.replacement) refreshStock();
    const text = res.replacement ? DOSE_REPLACED : DOSE_CANCELLED;
    rereadCard({ after: () => text, fallback: text });
  }

  // A transcrição devolve a caderneta (já com a conferência, se fechada): sem nova leitura.
  function onTranscribed(c: VaccinationCard) {
    setView(null);
    replaceCard(c);
    setSaved({ text: TRANSCRIPTION_SAVED, problem: null, redo: null });
  }

  // Enquanto relê (e se a releitura falhar) a caderneta velha não aparece: ela ainda ofereceria "Registrar" na dose recém-aplicada
  // (ou "Cancelar dose" na já cancelada).
  function rereadCard(redo: Redo) {
    if (!card || reread.isPending) return;
    const mine = ++seq.current;
    reread.mutate(card.patient.id, {
      onSuccess: (c) => {
        if (mine !== seq.current) return;
        replaceCard(c);
        setSaved({ text: redo.after(c), problem: null, redo });
      },
      onError: (err) => { if (mine === seq.current) setSaved({ text: redo.fallback, problem: vaccinationError(err), redo }); }
    });
  }

  function another() {
    drop();
    setView(null);
    setSaved(null);
    setCard(null);
    setSearch((s) => ({ round: s.round + 1 }));
  }

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Sala: ${room.name}`}</p>
      {card ? (
        <>
          <div style={row}>
            <button type="button" style={secondaryButtonStyle} onClick={another}>Outro cidadão</button>
          </div>
          {saved && (
            <>
              <p ref={savedRef} role="status" tabIndex={-1} style={{ margin: 0, fontSize: 13, color: "var(--ok)" }}>{saved.text}</p>
              {saved.problem && <p role="alert" style={alert}>{saved.problem}</p>}
            </>
          )}
          {reread.isPending ? <p className="mono" style={muted}>relendo a caderneta…</p>
          : saved?.problem && saved.redo ? (
            <div style={row}>
              <button type="button" style={secondaryButtonStyle} onClick={() => rereadCard(saved.redo as Redo)}>Reabrir a caderneta</button>
            </div>
          ) : catalog.data && view?.kind === "dose" ? (
            <DoseForm room={room} patient={card.patient} catalog={catalog.data} item={view.item} now={fixedNow} onSaved={onSaved}
              onCancel={() => setView(null)} />
          ) : catalog.data && view?.kind === "transcribe" ? (
            <TranscriptionForm room={room} card={card} catalog={catalog.data} today={fixedNow ? today : undefined} onDone={onTranscribed}
              onCancel={() => setView(null)} />
          ) : catalog.data && view?.kind === "cancel" ? (
            <CancelDose imm={view.imm} room={room} patient={card.patient} catalog={catalog.data} now={fixedNow} onDone={onCancelled}
              onCancel={() => setView(null)} onGoToSecurity={onGoToSecurity} />
          ) : catalog.data ? (
            // ESAVI entra na Task 15.
            <CardView room={room} card={card} catalog={catalog.data} now={now} onCard={replaceCard} onGoToSecurity={onGoToSecurity}
              onRecord={(item) => show({ kind: "dose", item })} onTranscribe={() => show({ kind: "transcribe" })}
              onCancelDose={(imm) => show({ kind: "cancel", imm })} />
          ) : catalog.isError ? <p role="alert" style={alert}>{vaccinationError(catalog.error)}</p>
            : <p className="mono" style={muted}>carregando…</p>}
        </>
      ) : (
        <section aria-label="Buscar cidadão" style={panel}>
          <h3 style={title}>Quem vai ser vacinado</h3>
          <PatientPick key={search.round} roomId={roomId} today={today} restart={search.restart} busy={read.isPending}
            onPick={open} onCancel={drop} />
          {read.isPending && <p className="mono" style={muted}>abrindo a caderneta…</p>}
          {problem && <p role="alert" style={alert}>{problem}</p>}
        </section>
      )}
    </div>
  );
}
