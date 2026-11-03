// Sala de vacina (módulo 29; F-29.2): portão → sala onde a pessoa vacina → busca do cidadão → caderneta. A caderneta é leitura
// nominal com trilha: lida por MUTAÇÃO no clique (`gcTime: 0`), nunca sozinha nem em cache; uma resposta de uma busca já trocada
// (outro cidadão, outra sala) é ignorada (`seq`). O catálogo é sem pessoa (STATIC_QUERY). "Outro cidadão" limpa tudo.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { errorCode, getVaccinationCard, getVaccinationCatalog, type CardRequest, type VaccinationCard, type VaccineLocation } from "../lib/api";
import { cityIsoDate } from "../lib/format";
import { STATIC_QUERY, VAC_CATALOG_KEY, vaccinationError } from "../lib/vaccination";
import { secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, panel, row, stack, title } from "./exams/styles";
import { VaccinationGate } from "./vaccination/VaccinationGate";
import { VaccineLocationPick } from "./vaccination/VaccineLocationPick";
import { PatientPick } from "./vaccination/PatientPick";
import { CardView } from "./vaccination/CardView";
import type { PersonRestart } from "./territory/PersonStart";

export function VaccinationRoom({ now = new Date(), onGoToSecurity }: { now?: Date; onGoToSecurity?(): void } = {}) {
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

function RoomBody({ room, now, onGoToSecurity }: { room: VaccineLocation; now: Date; onGoToSecurity?(): void }) {
  const roomId = room.room_id as string;
  const today = cityIsoDate(now);
  const catalog = useQuery({ queryKey: [ VAC_CATALOG_KEY ], queryFn: getVaccinationCatalog, ...STATIC_QUERY });
  const [ card, setCard ] = useState<VaccinationCard | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  // A busca remonta (round) em "Outro cidadão" e na volta do 409 duplicate_suspected (restart).
  const [ search, setSearch ] = useState<{ round: number; restart?: PersonRestart }>({ round: 0 });
  const seq = useRef(0);
  const read = useMutation({ gcTime: 0, mutationFn: (req: CardRequest) => getVaccinationCard(roomId, req) });

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

  function another() {
    drop();
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
          {catalog.data ? (
            // Registro, transcrição e ESAVI entram nas Tasks 7, 8 e 15.
            <CardView room={room} card={card} catalog={catalog.data} now={now} onCard={replaceCard} onGoToSecurity={onGoToSecurity}
              onRecord={() => undefined} onTranscribe={() => undefined} />
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
