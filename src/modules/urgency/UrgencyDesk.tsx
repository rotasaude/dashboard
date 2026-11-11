// A mesa da UPA dentro do Atendimento (módulo 32a; contrato §4–§7, §14 Q15): numa UPA com `urgency_care`, ela toma o lugar do
// check-in, da escuta, da fila, dos pedidos e da agenda do 13. Os painéis saem do papel de quem usa NESTA UPA (urgencyRoles):
// - recepção (`citizen_verifier`): a chegada (ArrivalForm) e, depois dela, a senha para entregar (TicketCard);
// - a fila da urgência (UrgencyQueue, para todos os papéis da UPA, o técnico 3222 inclusive: só lê); as ações dela e os painéis de
//   classificação, chamada, desfecho e identificação (Tasks 7–10) entram aqui, e `queueRef.current.refresh()` relê a fila depois de cada ação;
// - o mapa da observação (ObservationMap, 32b F-32.7) entre a fila e os provisórios; o desfecho (closeCare/closeLeaving) o relê;
// - enfermagem 2235: "Classificar"/"Reclassificar" abre a classificação de risco (ClassificationForm) num painel acima da fila.
// - chamada (F-32.5, contrato §6, §14 Q7): com `waiting_room_display`, o local da chamada (lembrado na sessão) fica no topo da fila e
//   vai em cada chamada. A enfermagem chama para a classificação; o médico 225 chama para o atendimento quem já foi classificado
//   ("Chamar" por linha e "Chamar próximo", que no api segue a ordem por cor); "Chamar de novo" repete o tipo da última chamada.
//   `already_called` só relê; `queue_empty` relê e diz "ninguém aguardando"; os pedidos de antes da urgência (E8) também releem
//   depois de cada chamada.
// - atendimento médico (F-32.4, §7): o médico que chama ("Chamar", "Chamar próximo") abre o atendimento (UrgencyCare) da linha
//   chamada, achada pelo `attendance_id` na fila relida (a resposta da chamada não traz a senha nem o encontro); "Atender" reabre.
//   Se "Chamar próximo" chamou um atendimento de antes da urgência (Q24, A14), o aviso aponta o painel dele.
// - desfecho de balcão: "Saiu sem atendimento" (todos os papéis) abre o desfecho com os tipos de balcão, sem ler o detalhe.
//   Registrado o desfecho, o painel fecha, a fila relê e o aviso só diz o tipo.
// - identificação (F-32.2, A8): só a recepção. "Identificar" nas linhas do provisório (as três faixas) e na lista de não
//   identificados (Q29, lida só quando pedida, também para o encontro já encerrado) abre o painel IdentifyPatient. Identificado, o
//   painel fecha, a fila relê e o aviso leva só o nome (nunca a descrição). A lista grava uma trilha por paciente a cada leitura:
//   relê só quando a identificação partiu dela; partindo da fila, a linha identificada sai da lista em cache, sem novo GET.
// Enquanto os vínculos do profissional carregam, nada de "seu papel não atua nesta UPA" (piscaria antes dos vínculos).
// Quem monta passa `key={unit.id}`: trocar de UPA remonta tudo e nada de uma unidade aparece na outra.
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  callAttendance, callForClassification, callNext, errorCode, getUrgencyQueue, recallAttendance,
  type HealthUnit, type ProfessionalLink, type ProvisionalEncounter, type QueueRow, type SessionUser, type UrgencyArrival, type UrgencyEncounter,
  type UrgencyInCareRow
} from "../../lib/api";
import { URGENCY_DETAIL_KEY, URGENCY_ERRORS, canUseWaitingRoom, colorLabel, urgencyError, urgencyRoles } from "../../lib/urgency";
import { useReveal } from "../../lib/useReveal";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { dangerButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ActionButton } from "../../components/ActionButton";
import { CallLocationPicker, atLocation, useCallLocation } from "../attendance/CallLocationPicker";
import { ArrivalForm } from "./ArrivalForm";
import { ClassificationForm } from "./ClassificationForm";
import { IdentifyPatient } from "./IdentifyPatient";
import { OutcomeForm, type OutcomeTarget } from "./OutcomeForm";
import { PROVISIONAL_KEY, ProvisionalEncounters, arrivalLabel } from "./ProvisionalEncounters";
import { UrgencyCare } from "./UrgencyCare";
import { TicketCard } from "./TicketCard";
import { ObservationMap, type ObservationMapHandle } from "./ObservationMap";
import { UrgencyQueue, type QueueActions, type UrgencyQueueHandle } from "./UrgencyQueue";

export const NO_UPA_ROLE = "seu papel não atua nesta UPA";
export const LINKS_LOADING = "carregando seus vínculos…";

// O painel aberto por uma linha da fila: só o id do encontro e a senha (o detalhe é lido pelo id, nunca vai na URL).
type Classifying = { encounterId: string; ticket: string | null };

// Quanto tempo o aviso de "classificado" fica à vista.
export const NOTICE_MS = 8_000;
export const DISCARD_QUESTION = "A classificação em andamento não foi enviada. Descartar o que foi digitado?";
export const PRE_URGENCY_CALLED = "é um atendimento de antes da urgência: abra “Atendimentos de antes da urgência”, abaixo.";

// A saída sem atendimento aberta por uma linha da fila: o bastante para o desfecho de balcão (sem o detalhe).
type Leaving = { target: OutcomeTarget; ticket: string | null };

// Escape dentro de um campo não fecha nada (quem digita pode estar só saindo de uma sugestão do navegador).
const inField = (el: EventTarget) => el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

interface PanelProps {
  target: Classifying;
  confirming: boolean;
  onDone(e: UrgencyEncounter): void;
  onClose(): void;
  onDirtyChange(dirty: boolean): void;
  onDiscard(): void;
  onKeep(): void;
}

// O painel de classificação: aparece à vista, com o foco no título (useReveal). Escape e "Cancelar" fecham; com algo digitado, a
// mesa pergunta antes (`confirming`), e o formulário segue montado com tudo o que foi digitado até a resposta.
function ClassificationPanel({ target, confirming, onDone, onClose, onDirtyChange, onDiscard, onKeep }: PanelProps) {
  const ref = useReveal<HTMLDivElement>(true);
  const questionId = useId();
  // Quem abriu o painel (lido na primeira renderização, antes do foco ir ao título): recebe o foco de volta ao descartar.
  const [ opener ] = useState<Element | null>(() => document.activeElement);
  const keep = () => {
    onKeep();
    ref.current?.querySelector<HTMLElement>("[data-reveal-title],h2,h3")?.focus();
  };
  const discard = () => {
    onDiscard();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) keepRef.current?.focus(); }, [ confirming ]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || inField(e.target)) return;
    e.stopPropagation();
    if (confirming) keep(); else onClose();
  };
  return (
    <div ref={ref} onKeyDown={onKeyDown}>
      <Panel title={`Classificação de risco — ${target.ticket ?? "sem senha"}`} sub="sinais vitais · dor · cor sugerida pelo protocolo">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {confirming && (
            <div role="alertdialog" aria-label="Descartar a classificação?" aria-describedby={questionId} style={confirmBox}>
              <p id={questionId} style={{ margin: 0, fontSize: 12.5 }}>{DISCARD_QUESTION}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button ref={keepRef} type="button" style={secondaryButtonStyle} onClick={keep}>Continuar classificando</button>
                <button type="button" style={dangerButtonStyle} onClick={discard}>Descartar</button>
              </div>
            </div>
          )}
          <ClassificationForm encounterId={target.encounterId} onDone={onDone} onCancel={onClose} onDirtyChange={onDirtyChange} />
        </div>
      </Panel>
    </div>
  );
}

// A saída sem atendimento pela fila (D14, Q10): os desfechos de balcão, com o foco no título.
function LeavingPanel({ leaving, doctor, onClosed }: { leaving: Leaving; doctor: boolean; onClosed(notice?: string): void }) {
  const ref = useReveal<HTMLDivElement>(true);
  return (
    <div ref={ref} onKeyDown={(e) => { if (e.key === "Escape" && !inField(e.target)) { e.stopPropagation(); onClosed(); } }}>
      <Panel title={`Saída — ${leaving.ticket ?? "sem senha"}`} sub="saída sem atendimento · registro por engano"
        right={<button type="button" style={secondaryButtonStyle} onClick={() => onClosed()}>Cancelar</button>}>
        <div style={{ padding: 16 }}>
          <OutcomeForm encounter={leaving.target} doctor={doctor} onRecorded={(_e, notice) => onClosed(notice)}
            onEncounterClosed={() => onClosed(URGENCY_ERRORS.encounter_closed)} />
        </div>
      </Panel>
    </div>
  );
}

// A identificação aberta por uma linha da fila ou da lista de provisórios: o id do encontro e o rótulo do painel.
type Identifying = { encounterId: string; label: string; from: "queue" | "list" };

// O painel da identificação, à vista e com o foco no título; Escape fora dos campos fecha (nada foi enviado ainda).
function IdentifyPanel({ target, onIdentified, onClose }: { target: Identifying; onIdentified(notice: string): void; onClose(): void }) {
  const ref = useReveal<HTMLDivElement>(true);
  return (
    <div ref={ref} onKeyDown={(e) => { if (e.key === "Escape" && !inField(e.target)) { e.stopPropagation(); onClose(); } }}>
      <Panel title={`Identificar paciente — ${target.label}`} sub="paciente existente (fusão, irreversível) · paciente novo">
        <div style={{ padding: 16 }}>
          <IdentifyPatient encounterId={target.encounterId} onIdentified={(_e, notice) => onIdentified(notice)} onCancel={onClose} />
        </div>
      </Panel>
    </div>
  );
}

const confirmBox: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", border: "1px solid var(--warn)", borderRadius: 8,
  background: "var(--warn-bg)"
};

export interface UrgencyDeskProps {
  unit: HealthUnit;
  user: SessionUser;
  links: ProfessionalLink[];
  // Os vínculos do profissional ainda carregando (`getMyProfessional`).
  linksLoading?: boolean;
  // Caminho para a verificação em duas etapas.
  onGoToSecurity?(): void;
}

export function UrgencyDesk({ unit, user, links, linksLoading = false, onGoToSecurity }: UrgencyDeskProps) {
  const roles = urgencyRoles(user, links, unit.id);
  const queueRef = useRef<UrgencyQueueHandle>(null);
  const mapRef = useRef<ObservationMapHandle>(null);
  const queryClient = useQueryClient();
  // A senha da última chegada; "Próxima chegada" volta ao formulário com o foco no documento.
  const [ arrival, setArrival ] = useState<UrgencyArrival | null>(null);
  const [ nextArrival, setNextArrival ] = useState(false);
  const [ classifying, setClassifying ] = useState<Classifying | null>(null);
  // O painel aberto agora (a resposta tardia de um painel descartado não fecha o de outra linha).
  const classifyingRef = useRef<Classifying | null>(null);
  // Uma chamada por vez; a recusa que não é do local aparece acima da fila.
  const calling = useRef(false);
  const [ callError, setCallError ] = useState<string | null>(null);
  const waitingRoom = canUseWaitingRoom(user) && (roles.nurse || roles.doctor);
  const location = useCallLocation(user.id, unit.id, waitingRoom);
  const [ notice, setNotice ] = useState<string | null>(null);
  // O formulário aberto tem algo digitado e não enviado.
  const [ dirty, setDirty ] = useState(false);
  // A troca pedida enquanto havia algo digitado: fechar (null) ou abrir outra linha; espera a resposta da pergunta.
  const [ asked, setAsked ] = useState<{ next: Classifying | null } | null>(null);
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);
  // O atendimento médico aberto (a linha de "em atendimento") e a saída sem atendimento aberta.
  const [ care, setCare ] = useState<UrgencyInCareRow | null>(null);
  const [ leaving, setLeaving ] = useState<Leaving | null>(null);
  const [ identifying, setIdentifying ] = useState<Identifying | null>(null);

  // O aviso some sozinho (timer limpo ao desmontar ou ao trocar o aviso).
  useEffect(() => {
    if (notice === null) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [ notice ]);

  // Trocar o painel tira o detalhe (queixa, sinais) do cache.
  const switchTo = (next: Classifying | null) => {
    setAsked(null); setDirty(false);
    queryClient.removeQueries({ queryKey: [ URGENCY_DETAIL_KEY ] });
    classifyingRef.current = next;
    setClassifying(next);
  };
  // Fechar ou abrir outra linha: com algo digitado, pergunta antes.
  const request = (next: Classifying | null) => {
    if (next && classifying?.encounterId === next.encounterId) return;
    if (classifying && dirty) { setAsked({ next }); return; }
    if (next) setNotice(null);
    switchTo(next);
  };
  const classified = (encounterId: string) => (e: UrgencyEncounter) => {
    // Carry da Task 7: o envio de um painel já descartado só relê a fila.
    if (classifyingRef.current?.encounterId !== encounterId) { queueRef.current?.refresh(); return; }
    setNotice(`${e.ticket ?? "Paciente"} classificado: ${e.color ? colorLabel(e.color) : "—"}.`);
    switchTo(null);
    queueRef.current?.refresh();
  };

  // Cada chamada: o local antes (obrigatório com TV ativa), o aviso com o local e a fila relida no fim, dê certo ou não.
  async function call(run: (loc: string | null) => Promise<string>) {
    if (calling.current || !location.ready()) return;
    calling.current = true; setCallError(null);
    try {
      setNotice(await run(location.selected));
    } catch (err) {
      const code = errorCode(err);
      if (code === "queue_empty") setNotice(URGENCY_ERRORS.queue_empty);
      else if (code !== "already_called" && !location.refused(err)) setCallError(urgencyError(err));
    } finally {
      calling.current = false;
      queueRef.current?.refresh();
      void queryClient.invalidateQueries({ queryKey: [ "unitQueue", unit.id ] });
    }
  }
  const label = (ticket: string | null) => ticket ?? "Paciente";

  // A linha chamada, em "em atendimento" da fila relida agora (a resposta da chamada só traz o id do atendimento).
  async function calledRow(attendanceId: string): Promise<UrgencyInCareRow | null> {
    try {
      return (await getUrgencyQueue(unit.id)).in_care.find((r) => r.attendance_id === attendanceId) ?? null;
    } catch {
      return null;
    }
  }
  // E8/A14: um atendimento do 13 aberto antes da urgência, na fila do 13 que o painel de baixo já leu.
  const preUrgencyRow = (attendanceId: string): QueueRow | null => {
    const q = queryClient.getQueryData<{ waiting?: QueueRow[]; in_care?: QueueRow[] }>([ "unitQueue", unit.id ]);
    return [ ...(q?.waiting ?? []), ...(q?.in_care ?? []) ].find((r) => r.id === attendanceId) ?? null;
  };
  const openCare = (row: UrgencyInCareRow) => { setLeaving(null); setCare(row); };
  // Fechar o atendimento ou a saída; com o desfecho registrado, o aviso (só o tipo) e a fila relida.
  const closeCare = (notice?: string) => {
    if (care) queryClient.removeQueries({ queryKey: [ URGENCY_DETAIL_KEY, care.encounter_id ] });
    setCare(null);
    // O desfecho fecha a estadia no api (contrato §4): o mapa relê junto com a fila.
    if (notice) { setNotice(notice); queueRef.current?.refresh(); mapRef.current?.refresh(); }
  };
  const closeLeaving = (notice?: string) => {
    setLeaving(null);
    if (notice) { setNotice(notice); queueRef.current?.refresh(); mapRef.current?.refresh(); }
  };
  // A descrição do provisório sai do cache ao fechar; identificado, a fila e a lista de provisórios (se aberta) releem.
  const openIdentify = (next: Identifying) => {
    if (identifying) queryClient.removeQueries({ queryKey: [ URGENCY_DETAIL_KEY, identifying.encounterId ] });
    setNotice(null); setIdentifying(next);
  };
  const closeIdentify = (notice?: string) => {
    if (identifying) queryClient.removeQueries({ queryKey: [ URGENCY_DETAIL_KEY, identifying.encounterId ] });
    setIdentifying(null);
    if (notice) {
      setNotice(notice);
      queueRef.current?.refresh();
      const key = [ PROVISIONAL_KEY, unit.id ];
      if (identifying?.from === "list") void queryClient.invalidateQueries({ queryKey: key });
      else {
        const id = identifying?.encounterId;
        queryClient.setQueryData<ProvisionalEncounter[]>(key, (old) => old?.filter((i) => i.encounter_id !== id));
      }
    }
  };

  // Q2: só a enfermagem 2235 classifica e chama para a classificação; o médico 225 chama para o atendimento (a fila também confere o
  // papel). "Chamar de novo" só com o painel da sala de espera (o api recusa sem ele).
  const actions: QueueActions = {
    ...(roles.nurse ? {
      onClassify: (row) => request({ encounterId: row.encounter_id, ticket: row.ticket }),
      onCallClassification: (row) => void call(async (loc) => {
        const r = await callForClassification(row.encounter_id, loc);
        return `${label(row.ticket)} chamada para a classificação${atLocation(r.call?.location)}`;
      })
    } satisfies QueueActions : {}),
    ...(roles.doctor ? {
      onCallCare: (row) => void call(async (loc) => {
        await (loc ? callAttendance(row.attendance_id, unit.id, loc) : callAttendance(row.attendance_id, unit.id));
        const called = await calledRow(row.attendance_id);
        if (called) openCare(called);
        return `${label(row.ticket)} chamada para o atendimento${atLocation(location.nameOf(loc))}`;
      }),
      onOpenCare: (row) => openCare(row)
    } satisfies QueueActions : {}),
    ...(roles.outcomeDesk ? {
      // A linha em atendimento traz o estado da consulta (Q30 e consultation_in_progress); a de espera ainda não tem consulta.
      // A consulta aberta do médico continua aberta (os dois painéis convivem).
      onLeft: (row) => setLeaving({
        target: { id: row.encounter_id, patient: row.patient, consultation_status: "consultation_status" in row ? row.consultation_status : null },
        ticket: row.ticket
      })
    } satisfies QueueActions : {}),
    ...(roles.identify ? {
      onIdentify: (row) => openIdentify({ encounterId: row.encounter_id, label: row.ticket ?? "sem senha", from: "queue" })
    } satisfies QueueActions : {}),
    ...(waitingRoom ? {
      onRecall: (row) => void call(async (loc) => {
        const r = await recallAttendance(row.attendance_id, loc);
        return `${label(row.ticket)} chamada de novo${atLocation(r.call?.location ?? location.nameOf(loc))}`;
      })
    } satisfies QueueActions : {})
  };
  const callNextNow = () => call(async (loc) => {
    const r = await (loc ? callNext(unit.id, loc) : callNext(unit.id));
    const where = atLocation(location.nameOf(loc));
    const called = await calledRow(r.attendance.id);
    if (called) {
      openCare(called);
      return `${label(called.ticket)} chamada para o atendimento${where}`;
    }
    const pre = preUrgencyRow(r.attendance.id);
    if (pre) return `${pre.ticket ?? "Próxima pessoa"} chamada para o atendimento${where} — ${PRE_URGENCY_CALLED}`;
    return `Próxima pessoa chamada para o atendimento${where}`;
  });
  const toolbar = waitingRoom || roles.doctor ? (
    <>
      <CallLocationPicker state={location} />
      {roles.doctor && <ActionButton onClick={callNextNow}>Chamar próximo</ActionButton>}
    </>
  ) : null;

  if (!roles.mapReader) {
    if (linksLoading) return <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>{LINKS_LOADING}</p>;
    return <EmptyState title={NO_UPA_ROLE} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {roles.reception && (
        <Panel title="Recepção da UPA" sub="chegada · senha · classificação de risco a seguir">
          {arrival ? (
            <TicketCard ticket={arrival.ticket} unitName={unit.name} onDone={() => { setArrival(null); setNextArrival(true); }} />
          ) : (
            <ArrivalForm unit={unit} autoFocus={nextArrival} onArrived={setArrival} />
          )}
        </Panel>
      )}
      {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{notice}</p>}
      {classifying && (
        <ClassificationPanel key={classifying.encounterId} target={classifying} confirming={asked !== null}
          onDone={classified(classifying.encounterId)}
          onClose={() => request(null)} onDirtyChange={onDirtyChange}
          onDiscard={() => { const next = asked?.next ?? null; if (next) setNotice(null); switchTo(next); }}
          onKeep={() => setAsked(null)} />
      )}
      {care && (
        <UrgencyCare key={care.encounter_id} row={care} unit={unit} units={[ unit ]} onClosed={closeCare} onGoToSecurity={onGoToSecurity} />
      )}
      {leaving && <LeavingPanel key={leaving.target.id} leaving={leaving} doctor={false} onClosed={closeLeaving} />}
      {identifying && (
        <IdentifyPanel key={identifying.encounterId} target={identifying} onIdentified={closeIdentify} onClose={() => closeIdentify()} />
      )}
      {callError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{callError}</p>}
      <UrgencyQueue ref={queueRef} unit={unit} roles={roles} actions={actions} toolbar={toolbar} />
      <ObservationMap ref={mapRef} unit={unit} roles={roles} />
      {roles.identify && (
        <ProvisionalEncounters unit={unit}
          onIdentify={(item) => openIdentify({ encounterId: item.encounter_id, label: arrivalLabel(item), from: "list" })} />
      )}
    </div>
  );
}
