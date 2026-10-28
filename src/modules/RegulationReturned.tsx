// RegulationReturned — os pedidos da unidade devolvidos pela regulação para complementar (módulo 26a; F-26.3).
// A unidade vem dos vínculos ativos de `getMyProfessional` (o api exige vínculo ativo nela). A lista é nominal e grava
// leitura na trilha: nunca relê sozinha (NOMINAL_QUERY); relê só depois de complementar ou no "Recarregar".
// "Complementar" reusa o `RequestForm` em `complement`: o pedido volta a `pending` e mantém a data original. O CID-10 que já
// estava no pedido conta (G12). `stale_version` (ou `invalid_transition`) mantém o texto digitado e oferece "Recarregar": ele relê
// a lista e troca o pedido aberto pelo de mesmo id com a versão nova, com o formulário montado (o rascunho sobrevive); se o
// pedido sumiu ou deixou de ser `returned`, o formulário fecha.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  complementRegulationRequest, errorCode, getConsultationOptions, getMyProfessional, listReturnedRequests,
  type ProfessionalLink, type RegulationRequest, type RegulationRequestInput
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { OPTIONS_KEY } from "../lib/consultation";
import { fmtDateTime } from "../lib/format";
import { documentText } from "../lib/patientDocument";
import {
  NOMINAL_QUERY, REG_RETURNED_KEY, STATIC_QUERY, draftFromRequest, regulationError, requesterKind, returnReason, typeLabel
} from "../lib/regulation";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, muted, okText, row, stack, title } from "./exams/styles";
import { ColorCell } from "./regulation/ColorCell";
import { RegulationGate } from "./regulation/RegulationGate";
import { RequestForm } from "./regulation/RequestForm";
import { NO_NAME } from "./regulation/RequestTable";

export const COMPLEMENTED_TEXT = "Pedido complementado: voltou para a fila da regulação, com a data do pedido original.";
const NO_LINK_TEXT = "você não tem vínculo ativo em nenhuma unidade";
const EMPTY_TEXT = "nenhum pedido devolvido para esta unidade";

interface UnitOption { id: string; name: string; cbo: string | null }

// Uma opção por unidade; havendo mais de um vínculo ativo na mesma unidade, vale o primeiro que pode pedir regulação.
function unitOptions(links: ProfessionalLink[]): UnitOption[] {
  const out: UnitOption[] = [];
  for (const l of links.filter((x) => !x.ended_at)) {
    const at = out.findIndex((u) => u.id === l.health_unit_id);
    if (at < 0) out.push({ id: l.health_unit_id, name: l.unit_name, cbo: l.cbo_code });
    else if (requesterKind(out[at].cbo) === null && requesterKind(l.cbo_code) !== null) out[at] = { id: l.health_unit_id, name: l.unit_name, cbo: l.cbo_code };
  }
  return out;
}

export function RegulationReturned() {
  return (
    <RegulationGate title="Encaminhamentos devolvidos" sub="pedidos da unidade devolvidos para complementar" allow={(r) => r.professional}>
      {() => <ReturnedBody />}
    </RegulationGate>
  );
}

function ReturnedBody() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [ unitId, setUnitId ] = useState<string | null>(null);
  const profile = useQuery({ queryKey: [ "myProfessional", userId ], queryFn: getMyProfessional, ...STATIC_QUERY });
  // Do usuário (qualquer vínculo médico ativo), não do vínculo escolhido: o api confere de novo pelo vínculo.
  const options = useQuery({ queryKey: [ OPTIONS_KEY, userId ], queryFn: getConsultationOptions, staleTime: 5 * 60_000, ...STATIC_QUERY });

  if (profile.isPending) return <p style={muted}>carregando…</p>;
  if (profile.isError) return <p role="alert" style={alert}>{regulationError(profile.error)}</p>;
  const units = unitOptions(profile.data?.links ?? []);
  if (units.length === 0) return <EmptyState title={NO_LINK_TEXT} />;
  const unit = units.find((u) => u.id === unitId) ?? units[0];

  return (
    <div style={stack}>
      {units.length > 1 ? (
        <label style={fieldLabel}>
          Unidade
          <select value={unit.id} style={inputStyle} onChange={(e) => setUnitId(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      ) : (
        <p style={muted}>{unit.name}</p>
      )}
      <ReturnedList key={unit.id} unit={unit} cid10Allowed={options.data?.cid10_allowed_for_cbo ?? null} optionsError={options.isError} />
    </div>
  );
}

function ReturnedList({ unit, cid10Allowed, optionsError }: { unit: UnitOption; cid10Allowed: boolean | null; optionsError: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = [ REG_RETURNED_KEY, unit.id ];
  const list = useQuery({ queryKey, queryFn: () => listReturnedRequests(unit.id), ...NOMINAL_QUERY });
  const [ editing, setEditing ] = useState<RegulationRequest | null>(null);
  const [ stale, setStale ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ cleared, setCleared ] = useState(0);
  const [ reloadError, setReloadError ] = useState<string | null>(null);
  // O pedido recém-complementado some da tela até a releitura terminar (um segundo clique daria invalid_transition).
  const [ done, setDone ] = useState<string | null>(null);

  const rows = (list.data ?? []).filter((r) => r.id !== done);
  const reread = () => queryClient.invalidateQueries({ queryKey });
  const close = () => { setEditing(null); setStale(false); setReloadError(null); };

  async function send(request: RegulationRequest, body: RegulationRequestInput) {
    // O corpo do complemento: sem tipo, alvo nem "regulado pelo estado" (o pedido já os tem).
    const { justification, cid10, ciap2, suggested_color } = body;
    try {
      await complementRegulationRequest(request.id, {
        justification, ...(cid10 !== undefined && { cid10 }), ...(ciap2 !== undefined && { ciap2 }), suggested_color, version: request.version
      });
    } catch (err) {
      const code = errorCode(err);
      if (code === "stale_version" || code === "invalid_transition") setStale(true);
      throw err; // o formulário mostra a frase e mantém o texto
    }
    close();
    setDone(request.id);
    setNotice(COMPLEMENTED_TEXT);
    try { await reread(); } finally { setDone(null); }
  }

  // Relê e troca o pedido aberto pela versão nova, sem desmontar o formulário. Sumiu ou não está mais devolvido: fecha.
  async function reload(openId: string) {
    setReloadError(null);
    const out = await list.refetch();
    if (out.isError) { setReloadError(regulationError(out.error)); return; }
    const fresh = (out.data ?? []).find((r) => r.id === openId && r.status === "returned");
    if (!fresh) { close(); return; }
    setStale(false);
    setCleared((n) => n + 1);
    setEditing(fresh);
  }

  if (editing) {
    const reason = returnReason(editing);
    return (
      <section aria-label={`Complementar ${editing.target.name}`} style={stack}>
        <div style={box}>
          <strong>{editing.target.name}</strong>
          <span className="mono" style={muted}>{`${editing.patient.display_name || NO_NAME} · ${documentText(editing.patient)}`}</span>
          {reason && <span style={muted}>{`Devolvido: ${reason}`}</span>}
        </div>
        <RequestForm key={editing.id} cbo={unit.cbo} cid10Allowed={cid10Allowed ?? false} mode="complement" submitLabel="Enviar complemento"
          initial={draftFromRequest(editing)} clearMessageKey={cleared} onSubmit={(body) => send(editing, body)} onCancel={close} />
        {stale && (
          <div style={row}>
            <button type="button" style={buttonStyle} onClick={() => void reload(editing.id)}>Recarregar</button>
            {reloadError && <span role="alert" style={alert}>{reloadError}</span>}
          </div>
        )}
      </section>
    );
  }

  return (
    <div style={stack}>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {optionsError && <p role="alert" style={alert}>não foi possível ler as regras de diagnóstico — recarregue a página</p>}
      {list.isPending && <p style={muted}>carregando…</p>}
      {list.isError && <p role="alert" style={alert}>{regulationError(list.error)}</p>}
      {list.data && rows.length === 0 && <EmptyState title={EMPTY_TEXT} />}
      {rows.length > 0 && (
        <ul style={listStyle}>
          {rows.map((r) => (
            <li key={r.id} aria-label={`${r.target.name} de ${r.patient.display_name || NO_NAME}`} style={item}>
              <div style={row}>
                <ColorCell request={r} />
                <h3 style={title}>{r.target.name}</h3>
                <span className="mono" style={muted}>{typeLabel(r.type)}</span>
              </div>
              <span><strong>{r.patient.display_name || NO_NAME}</strong> <span className="mono" style={muted}>{documentText(r.patient)}</span></span>
              <span style={muted}>{`Pedido em ${fmtDateTime(r.requested_at)}`}</span>
              <span style={muted}>Motivo da devolução</span>
              <span>{returnReason(r) ?? "—"}</span>
              <div style={row}>
                <button type="button" style={secondaryButtonStyle} disabled={cid10Allowed === null}
                  onClick={() => { setNotice(null); setStale(false); setEditing(r); }}>Complementar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const listStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 };
const item: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: 12, border: "1px solid var(--rule)", borderRadius: 8, fontSize: 12.5 };
