// SurveillanceQueue — a fila da vigilância epidemiológica (módulo 25; F-25.4):
// abas por situação, prazo (vencida / imediata) e filtros de doença e unidade.
// A lista é nominal e grava leitura na trilha: nunca relê sozinha (NOMINAL_QUERY
// — nem ao voltar à aba, nem ao reconectar, nem com o tempo). Só a contagem
// relê a cada minuto, pelo hook compartilhado com o menu. A ordem é a do api.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listNotifications, listSurveillanceDiseases, listSurveillanceUnits,
  type NotificationCounts, type NotificationQuery, type SurveillanceNotification
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSurveillanceCount } from "../hooks/useSurveillanceCount";
import { DISEASES_KEY, NOTIFICATIONS_KEY, NOMINAL_QUERY, STATIC_QUERY, UNITS_KEY, surveillanceError } from "../lib/surveillance";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";
import { NotificationTable } from "./surveillance/NotificationTable";

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

// A linha pode repetir entre páginas (a ordem é por prazo, não por id): a primeira vez vale.
function uniqueById(rows: SurveillanceNotification[]): SurveillanceNotification[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

// Páginas extras valem só para a lista (aba, filtros e leitura) que as pediu.
interface Extra { token: string; rows: SurveillanceNotification[]; next: string | null }
interface MoreState { token: string; busy: boolean; error: string | null }

export function SurveillanceQueue(_props: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Fila da vigilância" sub="notificações com prazo · vigilância epidemiológica" allow={(r) => r.surveillance}>
      {() => <QueueBody />}
    </SurveillanceGate>
  );
}

function QueueBody() {
  const { user } = useAuth();
  const [ tabKey, setTabKey ] = useState<QueueTab>("notified");
  const [ disease, setDisease ] = useState("");
  const [ unit, setUnit ] = useState("");
  const [ extra, setExtra ] = useState<Extra | null>(null);
  const [ moreState, setMoreState ] = useState<MoreState | null>(null);
  // A Task 6 desenha o detalhe a partir deste id.
  const [ , setOpenId ] = useState<string | null>(null);

  const counts = useSurveillanceCount(true, user?.id ?? null);
  const diseases = useQuery({ queryKey: [ DISEASES_KEY ], queryFn: listSurveillanceDiseases, ...STATIC_QUERY });
  const units = useQuery({ queryKey: [ UNITS_KEY ], queryFn: listSurveillanceUnits, ...STATIC_QUERY });

  const tab = QUEUE_TABS.find((t) => t.key === tabKey) ?? QUEUE_TABS[1];
  // Filtro vazio nunca vai ao api (ele recusaria `disease=`): "todas" é nulo.
  const query: NotificationQuery = { ...tab.query, disease: disease || null, unitId: unit || null };
  const list = useQuery({
    queryKey: [ NOTIFICATIONS_KEY, tabKey, disease, unit ], queryFn: () => listNotifications(query), ...NOMINAL_QUERY
  });

  const token = `${tabKey}|${disease}|${unit}|${list.dataUpdatedAt}`;
  const liveExtra = extra && extra.token === token ? extra : null;
  const more = moreState && moreState.token === token ? moreState : null;
  const rows = uniqueById([ ...(list.data?.notifications ?? []), ...(liveExtra?.rows ?? []) ]);
  const next = liveExtra ? liveExtra.next : list.data?.next_before ?? null;

  async function loadMore() {
    if (!next || more?.busy) return;
    const asked = token;
    setMoreState({ token: asked, busy: true, error: null });
    try {
      const page = await listNotifications({ ...query, before: next });
      setExtra((prev) => ({ token: asked, rows: [ ...(prev && prev.token === asked ? prev.rows : []), ...page.notifications ], next: page.next_before }));
      setMoreState({ token: asked, busy: false, error: null });
    } catch (err) {
      setMoreState({ token: asked, busy: false, error: surveillanceError(err) });
    }
  }

  const banner = bannerText(counts.data);
  // Os filtros só aparecem com as listas lidas; sem permissão para uma delas, a tela segue sem esse filtro.
  const filtersReady = !diseases.isPending && !units.isPending;
  const diseaseOptions = diseases.data ?? [];
  const unitOptions = units.data ?? [];

  return (
    <div style={stack}>
      {banner && <p role="status" style={bannerStyle}>{banner}</p>}
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
      <div role="tabpanel" style={stack}>
        {list.isPending && <p style={muted}>carregando…</p>}
        {list.isError && <p role="alert" style={alert}>{surveillanceError(list.error)}</p>}
        {list.data && <NotificationTable rows={rows} onOpen={setOpenId} />}
        {more?.error && <p role="alert" style={alert}>{more.error}</p>}
        {list.data && next && (
          <div style={row}>
            <button type="button" style={buttonStyle} disabled={more?.busy === true} onClick={() => void loadMore()}>
              {more?.busy ? "Carregando…" : "Carregar mais"}
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
