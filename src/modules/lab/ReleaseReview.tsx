// src/modules/lab/ReleaseReview.tsx
// Conferência e liberação de uma requisição (spec §5.6–§5.7; contrato §5):
// valores com marca e origem (aparelho chega "aguardando conferência"),
// repetições (o liberador escolhe a que vale), restrição da amostra, críticos
// (aviso antes ou confirmação de liberar sem aviso), exames a liberar
// (parcial quando nem todos) e a assinatura. O código do autenticador é
// apagado antes de cada envio; 409 devolve à fila.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  chooseLabResult, errorCode, getReleaseRequisition, releaseRequisition,
  type LabReleaseItem, type LabReportSummary, type LabResultRow, type LabSignatureKind
} from "../../lib/api";
import { LAB_CRITICALS_KEY, LAB_CRITICAL_COUNT_KEY, LAB_RELEASES_KEY, flagLabel, flagTone, isCritical, itemStatusLabel, labError, onlyIcp, totpProblem } from "../../lib/lab";
import { fmtDay } from "../../lib/exams";
import { hasFeature } from "../../lib/features";
import { useAuth } from "../../lib/auth";
import { fmtDateTime } from "../../lib/format";
import type { ModuleId } from "../../shell/modules";
import { ActionButton } from "../../components/ActionButton";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { CriticalNoticeForm } from "./CriticalNoticeForm";
import { LabReportList } from "./LabReportList";
import { RectifyForm } from "./RectifyForm";
import { NO_ICP_FOR_DOCTOR, SignatureChoice } from "./SignatureChoice";
import { alert, box, checkLabel, list, muted, panel, row, title } from "../exams/styles";

function byAnalyte(rows: LabResultRow[]): [ string, LabResultRow[] ][] {
  const groups = new Map<string, LabResultRow[]>();
  for (const r of rows) groups.set(r.analyte_key, [ ...(groups.get(r.analyte_key) ?? []), r ]);
  return [ ...groups.entries() ];
}

export function ReleaseReview({ requisitionId, council, onReleased, onConflict, onNavigate, onClose }: {
  requisitionId: string; council: string | null; onReleased(r: LabReportSummary): void; onConflict(text: string): void;
  onNavigate(id: ModuleId): void; onClose(): void;
}) {
  const query = useQuery({
    queryKey: [ LAB_RELEASES_KEY, "one", requisitionId ], queryFn: () => getReleaseRequisition(requisitionId), gcTime: 0, staleTime: 0, retry: false,
    refetchOnReconnect: false, refetchOnWindowFocus: false
  });
  const { user } = useAuth();
  // C5/B14: sem `digital_signature` a ICP não é oferecida e o padrão é a avançada.
  const icpAvailable = hasFeature(user, "digital_signature");
  const [ selected, setSelected ] = useState<string[] | null>(null);
  const [ kind, setKind ] = useState<LabSignatureKind>(icpAvailable ? "icp" : "advanced");
  const [ totp, setTotp ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ certificateLink, setCertificateLink ] = useState(false);
  const [ confirming, setConfirming ] = useState(false);
  const [ noticeFor, setNoticeFor ] = useState<LabResultRow | null>(null);
  const [ rectifying, setRectifying ] = useState<LabReportSummary | null>(null);
  // I1: uma ação de gravação por vez na conferência (liberar ou escolher valor).
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [ busy, setBusy ] = useState(false);
  const releasedOnce = useRef(false);
  // L3: a ICP foi recusada como indisponível nesta sessão — some das opções.
  const [ icpRefused, setIcpRefused ] = useState(false);
  const r = query.data;

  // Uma releitura que falha não derruba a conferência: enquanto há dado, ele fica na tela.
  if (!r) {
    if (query.isError) {
      return (
        <div style={row}>
          <p role="alert" style={alert}>{labError(query.error)}</p>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
        </div>
      );
    }
    return <p className="mono" style={muted}>carregando a requisição…</p>;
  }
  const available = icpAvailable && !icpRefused;

  const releasable = r.items.filter((i) => i.status === "typed");
  const chosenIds = selected ?? releasable.map((i) => i.id);
  const noIcpForDoctor = onlyIcp(council) && !available;
  const signature: LabSignatureKind = onlyIcp(council) ? "icp" : available ? kind : "advanced";
  const unnotified = r.items
    .filter((i) => chosenIds.includes(i.id))
    .flatMap((i) => i.results.filter((x) => x.effective && isCritical(x.flag) && x.notified !== true));
  const base = r.items.filter((i) => i.status !== "cancelled" && i.status !== "released");
  const partial = chosenIds.length < base.length;

  async function choose(row: LabResultRow) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      try {
        await chooseLabResult(row.id);
      } catch (err) {
        if (errorCode(err) === "invalid_transition" || errorCode(err) === "item_frozen") { onConflict(labError(err)); return; }
        setError(labError(err));
        return;
      }
      await reread("valor escolhido");
    } finally { inFlight.current = false; setBusy(false); }
  }

  // A retificação entra na mesma guarda de gravação (uma ação por vez).
  const writeGuard = {
    begin: () => { if (inFlight.current) return false; inFlight.current = true; setBusy(true); return true; },
    end: () => { inFlight.current = false; setBusy(false); },
    busy
  };

  // A ação já valeu; só a releitura falhou — não se diz que a ação falhou.
  async function reread(done: string) {
    const out = await query.refetch();
    if (out.isError) setError(`${done}, mas não foi possível reler a requisição — ${labError(out.error)}`);
  }

  async function release(confirmed: boolean) {
    if (chosenIds.length === 0) { setError("escolha ao menos um exame"); return; }
    if (noIcpForDoctor) { setError(NO_ICP_FOR_DOCTOR); return; }
    if (signature === "advanced") {
      const problem = totpProblem(totp);
      if (problem) { setError(problem); return; }
    }
    if (unnotified.length > 0 && !confirmed) { setConfirming(true); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setConfirming(false);
    setError(null);
    setCertificateLink(false);
    const code = totp;
    setTotp("");
    try {
      const report = await releaseRequisition(r!.id, signature === "advanced"
        ? { item_ids: chosenIds, signature, totp: code }
        : { item_ids: chosenIds, signature });
      releasedOnce.current = true;
      onReleased(report);
    } catch (err) {
      // Depois de um laudo criado, um erro tardio não substitui o sucesso.
      if (releasedOnce.current) return;
      const reason = errorCode(err);
      if (reason === "invalid_transition") { onConflict(labError(err)); return; }
      if (reason === "icp_required" && available) setKind("icp");
      if (reason === "signature_unavailable") {
        setIcpRefused(true);
        setKind("advanced");
        setError(onlyIcp(council) ? NO_ICP_FOR_DOCTOR : labError(err));
        return;
      }
      if (reason === "no_active_certificate") setCertificateLink(true);
      setError(labError(err));
    } finally { inFlight.current = false; setBusy(false); }
  }

  const itemBlock = (i: LabReleaseItem) => (
    <div key={i.id} style={box}>
      <label style={checkLabel}>
        <input type="checkbox" disabled={i.status !== "typed"} checked={chosenIds.includes(i.id)}
          onChange={(e) => { setConfirming(false); setSelected(e.target.checked ? [ ...chosenIds, i.id ] : chosenIds.filter((x) => x !== i.id)); }} />
        <strong>{i.label}</strong> <span style={muted}>{`v${i.version} · ${itemStatusLabel(i.status)}`}</span>
      </label>
      {i.restriction_note && <p style={alert}>{`restrição da amostra: ${i.restriction_note}`}</p>}
      {byAnalyte(i.results).map(([ key, rows ]) => (
        <ul key={key} aria-label={`${rows[0].name} · valores`} style={list}>
          {rows.map((x) => (
            <li key={x.id} style={row}>
              <span>{`${x.value}${x.unit ? ` ${x.unit}` : ""} · ${x.source === "hl7" ? "aparelho — conferir" : `digitado${x.entered_by ? ` por ${x.entered_by}` : ""}`} · ${fmtDateTime(x.entered_at)}`}</span>
              {x.flag !== "normal" && <Tag tone={flagTone(x.flag)}>{flagLabel(x.flag)}</Tag>}
              {x.effective ? <Tag tone="ok">vale</Tag> : rows.length > 1 && (
                <ActionButton variant="secondary" busy={busy} onClick={() => choose(x)}>{`Usar ${x.value}`}</ActionButton>
              )}
              {x.effective && isCritical(x.flag) && x.notified !== true && (
                <button type="button" style={secondaryButtonStyle} onClick={() => setNoticeFor(x)}>Registrar aviso</button>
              )}
            </li>
          ))}
        </ul>
      ))}
      {noticeFor && i.results.some((x) => x.id === noticeFor.id) && (
        <CriticalNoticeForm key={noticeFor.id} guard={writeGuard} resultId={noticeFor.id} label={noticeFor.name}
          onCancel={() => setNoticeFor(null)} onDone={() => {
            setNoticeFor(null);
            // Só os críticos: a requisição desta conferência é relida uma vez pelo reread (rota com trilha).
            for (const key of [ LAB_CRITICALS_KEY, LAB_CRITICAL_COUNT_KEY ]) void queryClient.invalidateQueries({ queryKey: [ key ] }).catch(() => undefined);
            void reread("aviso registrado");
          }} />
      )}
    </div>
  );

  return (
    <section aria-label={`Conferência da requisição ${r.number}`} style={panel}>
      <div style={row}>
        <h3 style={title}>{`Requisição ${r.number}`}</h3>
        {r.urgent && <Tag tone="urgent">urgente</Tag>}
      </div>
      <p style={muted}>{`${r.patient.display_name} · nascimento ${fmtDay(r.patient.birth_date)}`}</p>
      {r.items.map(itemBlock)}
      {r.reports.length > 0 && (
        <LabReportList reports={r.reports} onRectify={setRectifying} onExpired={() => void query.refetch()} />
      )}
      {rectifying && (
        <RectifyForm key={rectifying.id} report={rectifying} items={r.items} council={council} guard={writeGuard} onCancel={() => setRectifying(null)}
          onConflict={onConflict} onDone={(rep) => { setRectifying(null); onReleased(rep); }} />
      )}
      {releasable.length > 0 && (
        <SignatureChoice council={council} kind={signature} onKind={(k) => { if (k === "icp") setTotp(""); setKind(k); }} totp={totp} onTotp={setTotp} icpAvailable={available} />
      )}
      {confirming && unnotified.length > 0 && (
        <div role="group" aria-label="crítico sem aviso" style={box}>
          <p style={{ margin: 0 }}>{`${unnotified.length === 1 ? "1 valor crítico" : `${unnotified.length} valores críticos`} sem registro de aviso. Liberar mesmo assim? O aviso fica pendente em Críticos sem aviso.`}</p>
          <div style={row}>
            <ActionButton busy={busy} onClick={() => release(true)}>Liberar sem aviso</ActionButton>
            <button type="button" style={secondaryButtonStyle} onClick={() => { setConfirming(false); setTotp(""); setNoticeFor(unnotified[0]); }}>Registrar o aviso antes</button>
          </div>
        </div>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      {certificateLink && (
        <div><button type="button" style={secondaryButtonStyle} onClick={() => onNavigate("signature")}>Ir para Assinatura digital</button></div>
      )}
      <div style={row}>
        {releasable.length > 0 && (
          <ActionButton busy={busy} disabledReason={noIcpForDoctor ? "sem assinatura ICP o médico não consegue liberar" : null} onClick={() => release(false)}>
            {partial ? `Liberar laudo parcial (${chosenIds.length} de ${base.length})` : "Liberar laudo"}
          </ActionButton>
        )}
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
      </div>
    </section>
  );
}
