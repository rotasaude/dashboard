// A mesa da UPA dentro do Atendimento (módulo 32a; contrato §4–§7, §14 Q15): numa UPA com `urgency_care`, ela toma o lugar do
// check-in, da escuta, da fila, dos pedidos e da agenda do 13. Os painéis saem do papel de quem usa NESTA UPA (urgencyRoles):
// - recepção (`citizen_verifier`): a chegada (ArrivalForm) e, depois dela, a senha para entregar (TicketCard);
// - a fila da urgência (UrgencyQueue, para todos os papéis da UPA); as ações dela e os painéis de classificação, chamada, desfecho
//   e identificação (Tasks 7–10) entram aqui, e `queueRef.current.refresh()` relê a fila depois de cada ação;
// - enfermagem 2235: "Classificar"/"Reclassificar" abre a classificação de risco (ClassificationForm) num painel acima da fila.
// Enquanto os vínculos do profissional carregam, nada de "seu papel não atua nesta UPA" (piscaria antes dos vínculos).
// Quem monta passa `key={unit.id}`: trocar de UPA remonta tudo e nada de uma unidade aparece na outra.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { HealthUnit, ProfessionalLink, SessionUser, UrgencyArrival, UrgencyEncounter } from "../../lib/api";
import { URGENCY_DETAIL_KEY, colorLabel, urgencyRoles } from "../../lib/urgency";
import { useReveal } from "../../lib/useReveal";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { dangerButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ArrivalForm } from "./ArrivalForm";
import { ClassificationForm } from "./ClassificationForm";
import { TicketCard } from "./TicketCard";
import { UrgencyQueue, type QueueActions, type UrgencyQueueHandle } from "./UrgencyQueue";

export const NO_UPA_ROLE = "seu papel não atua nesta UPA";
export const LINKS_LOADING = "carregando seus vínculos…";

// O painel aberto por uma linha da fila: só o id do encontro e a senha (o detalhe é lido pelo id, nunca vai na URL).
type Classifying = { encounterId: string; ticket: string | null };

// Quanto tempo o aviso de "classificado" fica à vista.
export const NOTICE_MS = 8_000;
export const DISCARD_QUESTION = "A classificação em andamento não foi enviada. Descartar o que foi digitado?";

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
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) keepRef.current?.focus(); }, [ confirming ]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || inField(e.target)) return;
    e.stopPropagation();
    if (confirming) onKeep(); else onClose();
  };
  return (
    <div ref={ref} onKeyDown={onKeyDown}>
      <Panel title={`Classificação de risco — ${target.ticket ?? "sem senha"}`} sub="sinais vitais · dor · cor sugerida pelo protocolo">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {confirming && (
            <div role="alertdialog" aria-label="Descartar a classificação?" style={confirmBox}>
              <p style={{ margin: 0, fontSize: 12.5 }}>{DISCARD_QUESTION}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button ref={keepRef} type="button" style={secondaryButtonStyle} onClick={onKeep}>Continuar classificando</button>
                <button type="button" style={dangerButtonStyle} onClick={onDiscard}>Descartar</button>
              </div>
            </div>
          )}
          <ClassificationForm encounterId={target.encounterId} onDone={onDone} onCancel={onClose} onDirtyChange={onDirtyChange} />
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
  // Relógio da fila e caminho para a verificação em duas etapas (Tasks 6–10).
  now?(): Date;
  onGoToSecurity?(): void;
}

export function UrgencyDesk({ unit, user, links, linksLoading = false }: UrgencyDeskProps) {
  const roles = urgencyRoles(user, links, unit.id);
  const queueRef = useRef<UrgencyQueueHandle>(null);
  const queryClient = useQueryClient();
  // A senha da última chegada; "Próxima chegada" volta ao formulário com o foco no documento.
  const [ arrival, setArrival ] = useState<UrgencyArrival | null>(null);
  const [ nextArrival, setNextArrival ] = useState(false);
  const [ classifying, setClassifying ] = useState<Classifying | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  // O formulário aberto tem algo digitado e não enviado.
  const [ dirty, setDirty ] = useState(false);
  // A troca pedida enquanto havia algo digitado: fechar (null) ou abrir outra linha; espera a resposta da pergunta.
  const [ asked, setAsked ] = useState<{ next: Classifying | null } | null>(null);
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

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
    setClassifying(next);
  };
  // Fechar ou abrir outra linha: com algo digitado, pergunta antes.
  const request = (next: Classifying | null) => {
    if (next && classifying?.encounterId === next.encounterId) return;
    if (classifying && dirty) { setAsked({ next }); return; }
    if (next) setNotice(null);
    switchTo(next);
  };
  const classified = (e: UrgencyEncounter) => {
    setNotice(`${e.ticket ?? "Paciente"} classificado: ${e.color ? colorLabel(e.color) : "—"}.`);
    switchTo(null);
    queueRef.current?.refresh();
  };
  // Q2: só a enfermagem 2235 classifica (a fila também confere o papel).
  const actions: QueueActions = roles.nurse
    ? { onClassify: (row) => request({ encounterId: row.encounter_id, ticket: row.ticket }) }
    : {};

  if (!roles.reception && !roles.nurse && !roles.doctor) {
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
        <ClassificationPanel key={classifying.encounterId} target={classifying} confirming={asked !== null} onDone={classified}
          onClose={() => request(null)} onDirtyChange={onDirtyChange}
          onDiscard={() => { const next = asked?.next ?? null; if (next) setNotice(null); switchTo(next); }}
          onKeep={() => setAsked(null)} />
      )}
      <UrgencyQueue ref={queueRef} unit={unit} roles={roles} actions={actions} />
    </div>
  );
}
