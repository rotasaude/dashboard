// SurveillanceQueue — a fila da vigilância epidemiológica (módulo 25; F-25.4):
// abas por situação, prazo (vencida / imediata) e filtros de doença e unidade.
// A lista é nominal e grava leitura na trilha: nunca relê sozinha (NOMINAL_QUERY
// — nem ao voltar à aba, nem ao reconectar, nem com o tempo). Só a contagem
// relê a cada minuto, pelo hook compartilhado com o menu. A ordem é a do api.
// "Notificação manual" abre o painel da notificação sem consulta; criada (ou a
// já existente, no 409), abre o detalhe dela.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listNotifications, listSurveillanceDiseases, listSurveillanceUnits,
  type NotificationCounts, type NotificationQuery
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSurveillanceCount } from "../hooks/useSurveillanceCount";
import { usePagedNotifications } from "../hooks/usePagedNotifications";
import { DISEASES_KEY, NOTIFICATIONS_KEY, NOMINAL_QUERY, STATIC_QUERY, UNITS_KEY, surveillanceError } from "../lib/surveillance";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";
import { NotificationTable } from "./surveillance/NotificationTable";
import { NotificationDetail } from "./surveillance/NotificationDetail";
import { ManualNotificationPanel } from "./surveillance/ManualNotificationPanel";

export type QueueTab = "possible" | "notified" | "investigating" | "overdue" | "closed" | "entered" | "dismissed";

interface TabSpec {
  key: QueueTab; label: string; query: NotificationQuery;
  // Contagem mostrada na aba (as cinco primeiras).
  count?: keyof NotificationCounts;
}

export const QUEUE_TABS: TabSpec[] = [
  { key: "possible", label: "Possíveis não feitas", query: { status: "possible" }, count: "possible" },
  { key: "notified", label: "Notificadas", query: { status: "notified" }, count: "notified" },
  { key: "investigating", label: "Em investigação", query: { status: "investigating" }, count: "investigating" },
  // "Vencidas" pede overdue e nenhuma situação: o api exclui digitadas e descartadas.
  { key: "overdue", label: "Vencidas", query: { overdue: true }, count: "overdue" },
  { key: "closed", label: "Sem número oficial", query: { withoutOfficialNumber: true }, count: "without_official_number" },
  { key: "entered", label: "Digitadas", query: { status: "entered" } },
  { key: "dismissed", label: "Descartadas", query: { status: "dismissed" } }
];

const tabLabel = (tab: TabSpec, counts: NotificationCounts | undefined): string =>
  tab.count && counts ? `${tab.label} (${counts[tab.count]})` : tab.label;

function bannerText(counts: NotificationCounts | undefined): string | null {
  if (!counts) return null;
  const parts: string[] = [];
  if (counts.immediate_open > 0) {
    parts.push(counts.immediate_open === 1 ? "1 notificação imediata aberta" : `${counts.immediate_open} notificações imediatas abertas`);
  }
  if (counts.overdue > 0) parts.push(counts.overdue === 1 ? "1 vencida" : `${counts.overdue} vencidas`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function SurveillanceQueue({ today }: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Fila da vigilância" sub="notificações com prazo · vigilância epidemiológica" allow={(r) => r.surveillance}>
      {() => <QueueBody today={today} />}
    </SurveillanceGate>
  );
}

function QueueBody({ today }: { today?: string }) {
  const { user } = useAuth();
  const [ tabKey, setTabKey ] = useState<QueueTab>("notified");
  const [ disease, setDisease ] = useState("");
  const [ unit, setUnit ] = useState("");
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ manual, setManual ] = useState(false);
  const openNotification = (id: string) => { setManual(false); setOpenId(id); };

  const counts = useSurveillanceCount(true, user?.id ?? null);
  const diseases = useQuery({ queryKey: [ DISEASES_KEY ], queryFn: listSurveillanceDiseases, ...STATIC_QUERY });
  const units = useQuery({ queryKey: [ UNITS_KEY ], queryFn: listSurveillanceUnits, ...STATIC_QUERY });

  const tab = QUEUE_TABS.find((t) => t.key === tabKey) ?? QUEUE_TABS[1];
  // Filtro vazio nunca vai ao api (ele recusaria `disease=`): "todas" é nulo.
  const query: NotificationQuery = { ...tab.query, disease: disease || null, unitId: unit || null };
  const list = useQuery({
    queryKey: [ NOTIFICATIONS_KEY, tabKey, disease, unit ], queryFn: () => listNotifications(query), ...NOMINAL_QUERY
  });

  // As páginas extras valem só para a lista (aba, filtros e leitura) que as pediu.
  const { rows, next, more, loadMore } = usePagedNotifications(list, query, `${tabKey}|${disease}|${unit}`);

  const banner = bannerText(counts.data);
  // Os filtros só aparecem com as listas lidas; sem permissão para uma delas, a tela segue sem esse filtro.
  const filtersReady = !diseases.isPending && !units.isPending;
  const diseaseOptions = diseases.data ?? [];
  const unitOptions = units.data ?? [];

  return (
    <div style={stack}>
      {banner && <p role="status" style={bannerStyle}>{banner}</p>}
      {!manual && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => { setOpenId(null); setManual(true); }}>Notificação manual</button>
        </div>
      )}
      {manual && (
        <ManualNotificationPanel today={today} onCreated={(n) => openNotification(n.id)} onOpenExisting={openNotification}
          onCancel={() => setManual(false)} />
      )}
      <div role="tablist" aria-label="Situação das notificações" style={tabList}>
        {QUEUE_TABS.map((t) => {
          const active = t.key === tabKey;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} className="mono"
              style={active ? tabActive : tabIdle} onClick={() => setTabKey(t.key)}>
              {tabLabel(t, counts.data)}
            </button>
          );
        })}
      </div>
      {filtersReady && (diseaseOptions.length > 0 || unitOptions.length > 0) && (
        <div style={{ ...row, alignItems: "flex-end" }}>
          {diseaseOptions.length > 0 && (
            <label style={fieldLabel}>
              Doença
              <select value={disease} style={inputStyle} onChange={(e) => setDisease(e.target.value)}>
                <option value="">Todas</option>
                {diseaseOptions.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
              </select>
            </label>
          )}
          {unitOptions.length > 0 && (
            <label style={fieldLabel}>
              Unidade
              <select value={unit} style={inputStyle} onChange={(e) => setUnit(e.target.value)}>
                <option value="">Todas</option>
                {unitOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {/* O detalhe lê ao abrir e depois de uma ação; a chave zera o formulário ao abrir outra. */}
      {openId && <NotificationDetail key={openId} id={openId} onClose={() => setOpenId(null)} />}
      <div role="tabpanel" style={stack}>
        {list.isPending && <p style={muted}>carregando…</p>}
        {list.isError && <p role="alert" style={alert}>{surveillanceError(list.error)}</p>}
        {list.data && <NotificationTable rows={rows} onOpen={openNotification} />}
        {more.error && <p role="alert" style={alert}>{more.error}</p>}
        {list.data && next && (
          <div style={row}>
            <button type="button" style={buttonStyle} disabled={more.busy} onClick={() => void loadMore()}>
              {more.busy ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const bannerStyle: CSSProperties = {
  margin: 0, padding: 12, borderRadius: 8, border: "1px solid var(--down)", background: "var(--sunken)", fontSize: 12.5, fontWeight: 600
};
const tabList: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4 };
const tabBase: CSSProperties = { padding: "4px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: 0.3 };
const tabIdle: CSSProperties = { ...tabBase, border: "1px solid var(--rule2)", background: "transparent", color: "var(--ink2)" };
const tabActive: CSSProperties = { ...tabBase, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)" };
