// RegulationQueue — a fila regulada do care_regulator (módulo 26a; F-26.3):
// abas por situação, filtros de cor e de especialidade/procedimento, cor, prazo
// da cor e tempo de espera. A lista é nominal e grava leitura na trilha: nunca
// relê sozinha (NOMINAL_QUERY — nem ao voltar à aba, nem ao reconectar, nem com
// o tempo). Só a contagem relê a cada minuto, pelo hook compartilhado com o menu.
// A ordem é a do api (vencidos, cor, data — contrato §13 G2): a tela lê UMA vez,
// sem `overdue`, e só parte as linhas carregadas em "Vencidos" e "No prazo". "Exportar CSV para o sistema do estado" (F-26.6)
// baixa a situação da aba por um link temporário; o nome do arquivo não leva dado pessoal. O número externo
// (`ExternalNumberForm`) entra no detalhe pelo espaço `extra`.
import { useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStateExportCsv, listRegulationRequests, type RegulationQuery, type RegulationRequest, type RegulationTarget, type RegulationType, type RiskColor } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRegulationCount } from "../hooks/useRegulationCount";
import { COLORS, NOMINAL_QUERY, REG_COUNT_KEY, REG_LIST_KEY, exportFilename, regulationError, statusLabel, typeLabel } from "../lib/regulation";
import { cityIsoDate } from "../lib/format";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack, title } from "./exams/styles";
import { saveFile } from "./lab/saveFile";
import { ExternalNumberForm } from "./regulation/ExternalNumberForm";
import { RegulationGate } from "./regulation/RegulationGate";
import { RequestDetail } from "./regulation/RequestDetail";
import { RequestTable } from "./regulation/RequestTable";
import { TargetSearch } from "./regulation/TargetSearch";

export type QueueTab = "pending" | "returned" | "authorized" | "scheduled" | "external" | "finished";

interface TabSpec {
  key: QueueTab; label: string;
  // Situação lida; a aba "Encerrados" tem a sua escolha no select "Situação".
  status: string;
  // Contagem mostrada na aba (as que o /count traz).
  count?: "pending" | "returned" | "authorized" | "external";
}

// "Aguardando" é uma leitura só; os dois blocos (vencidos e no prazo) são só de exibição.
export const QUEUE_TABS: TabSpec[] = [
  { key: "pending", label: "Aguardando", status: "pending", count: "pending" },
  { key: "returned", label: "Devolvidos", status: "returned", count: "returned" },
  { key: "authorized", label: "Autorizados", status: "authorized", count: "authorized" },
  { key: "scheduled", label: "Agendados", status: "scheduled" },
  { key: "external", label: "Pelo estado", status: "external", count: "external" },
  { key: "finished", label: "Encerrados", status: "completed" }
];

export const STATE_NOTE = "Regulados pelo estado não entram na fila municipal nem consomem cota.";

export const FINISHED_STATUSES: string[] = [ "completed", "denied", "cancelled", "closed" ];

const TYPES: RegulationType[] = [ "specialty", "procedure" ];

export function RegulationQueue({ today }: { today?: string } = {}) {
  return (
    <RegulationGate title="Fila regulada" sub="pedidos por cor e espera, vencidos primeiro" allow={(r) => r.regulator}>
      {() => <QueueBody today={today} />}
    </RegulationGate>
  );
}

function bannerText(overdue: number | undefined): string | null {
  if (!overdue || overdue <= 0) return null;
  return overdue === 1 ? "1 pedido vencido" : `${overdue} pedidos vencidos`;
}

function uniqueById(rows: RegulationRequest[]): RegulationRequest[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

function QueueBody({ today }: { today?: string }) {
  const { user } = useAuth();
  const day = today ?? cityIsoDate();
  const [ tabKey, setTabKey ] = useState<QueueTab>("pending");
  const [ finished, setFinished ] = useState(FINISHED_STATUSES[0]);
  const [ color, setColor ] = useState<RiskColor | "">("");
  const [ type, setType ] = useState<RegulationType>("specialty");
  const [ target, setTarget ] = useState<RegulationTarget | null>(null);
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ exporting, setExporting ] = useState(false);
  const [ exportError, setExportError ] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const counts = useRegulationCount(true, user?.id ?? null);
  const tab = QUEUE_TABS.find((t) => t.key === tabKey) ?? QUEUE_TABS[0];
  // Filtro vazio nunca vai ao api: "todas" é nulo; o tipo só vai com o alvo escolhido.
  const query: RegulationQuery = {
    status: tab.key === "finished" ? finished : tab.status, type: target ? type : null, targetCode: target?.code ?? null, color: color || null
  };
  const list = useInfiniteQuery({
    queryKey: [ REG_LIST_KEY, query ],
    queryFn: ({ pageParam }) => listRegulationRequests(pageParam ? { ...query, before: pageParam } : query),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });

  const rows = uniqueById((list.data?.pages ?? []).flatMap((p) => p.requests));
  // Sem reordenar: o api manda os vencidos primeiro, então cada bloco guarda a ordem dele.
  const late = tab.key === "pending" ? rows.filter((r) => r.overdue) : [];
  const onTime = tab.key === "pending" ? rows.filter((r) => !r.overdue) : [];
  const banner = bannerText(counts.data?.overdue);
  const open = (r: RegulationRequest) => { setNotice(null); setOpenId(r.id); };
  const label = (t: TabSpec) => (t.count && counts.data ? `${t.label} (${counts.data[t.count]})` : t.label);
  const changeType = (next: RegulationType) => { setType(next); setTarget(null); };
  // Cada página da lista é uma leitura nominal com trilha: só relê quando uma decisão mudou a fila, e volta à primeira
  // página (uma leitura). A contagem das abas e do menu é invalidada junto; sem decisão, nenhuma leitura.
  const back = (changed: boolean) => {
    setOpenId(null);
    if (!changed) return;
    void queryClient.resetQueries({ queryKey: [ REG_LIST_KEY, query ] });
    void queryClient.invalidateQueries({ queryKey: [ REG_COUNT_KEY ] });
  };
  const decided = (text: string) => { back(true); setNotice(text); };
  // A situação da aba vai ao api; sem nome seguro dele, o nome é por data (sem dado pessoal).
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const file = await fetchStateExportCsv(query.status);
      saveFile(file, file.filename ?? exportFilename(day));
    } catch (err) {
      setExportError(regulationError(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={stack}>
      {banner && <p role="status" style={bannerStyle}>{banner}</p>}
      {notice && <p role="status" style={okText}>{notice}</p>}
      <div role="tablist" aria-label="Situação dos pedidos" style={tabList}>
        {QUEUE_TABS.map((t) => {
          const active = t.key === tabKey;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} className="mono"
              style={active ? tabActive : tabIdle} onClick={() => { setTabKey(t.key); setOpenId(null); setNotice(null); setExportError(null); }}>
              {label(t)}
            </button>
          );
        })}
      </div>
      {!openId && <div style={{ ...row, alignItems: "flex-end" }}>
        {tab.key === "finished" && (
          <label style={fieldLabel}>
            Situação
            <select value={finished} style={inputStyle} onChange={(e) => setFinished(e.target.value)}>
              {FINISHED_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
        )}
        <label style={fieldLabel}>
          Cor
          <select value={color} style={inputStyle} onChange={(e) => setColor(e.target.value as RiskColor | "")}>
            <option value="">Todas</option>
            {COLORS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Tipo
          <select value={type} style={inputStyle} onChange={(e) => changeType(e.target.value as RegulationType)}>
            {TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
        </label>
        {target ? (
          <div style={row}>
            <span style={chosen}>{`${target.code} — ${target.name}`}</span>
            <button type="button" style={secondaryButtonStyle} onClick={() => setTarget(null)}>Limpar</button>
          </div>
        ) : (
          <TargetSearch type={type} onPick={setTarget} />
        )}
      </div>}
      {!openId && (
        <div style={row}>
          <button type="button" style={exporting ? disabledButtonStyle : secondaryButtonStyle} disabled={exporting} onClick={() => void exportCsv()}>
            Exportar CSV para o sistema do estado
          </button>
          {tab.key === "external" && <p style={muted}>{STATE_NOTE}</p>}
        </div>
      )}
      {!openId && exportError && <p role="alert" style={alert}>{exportError}</p>}
      {openId ? (
        <RequestDetail key={openId} id={openId} today={day} onBack={back} onChanged={decided}
          extra={(ctx) => <ExternalNumberForm request={ctx.request} onApplied={ctx.applied} onChanged={ctx.notify} onStale={ctx.stale} onStart={ctx.begin} />} />
      ) : (
        <div role="tabpanel" style={stack}>
          {list.isPending && <p style={muted}>carregando…</p>}
          {list.isError && <p role="alert" style={alert}>{regulationError(list.error)}</p>}
          {list.data && tab.key !== "pending" && <RequestTable rows={rows} today={day} onOpen={open} />}
          {list.data && tab.key === "pending" && rows.length === 0 && <RequestTable rows={[]} today={day} onOpen={open} />}
          {list.data && late.length > 0 && (
            <section aria-label="Vencidos" style={stack}>
              <h3 style={title}>Vencidos</h3>
              <RequestTable rows={late} today={day} onOpen={open} />
            </section>
          )}
          {list.data && onTime.length > 0 && (
            <section aria-label="No prazo" style={stack}>
              <h3 style={title}>No prazo</h3>
              <RequestTable rows={onTime} today={day} onOpen={open} />
            </section>
          )}
          {list.data && list.hasNextPage && (
            <div style={row}>
              <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const bannerStyle: CSSProperties = {
  margin: 0, padding: 12, borderRadius: 8, border: "1px solid var(--down)", background: "var(--sunken)", fontSize: 12.5, fontWeight: 600
};
const chosen: CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--ink)" };
const tabList: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4 };
const tabBase: CSSProperties = { padding: "4px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: 0.3 };
const tabIdle: CSSProperties = { ...tabBase, border: "1px solid var(--rule2)", background: "transparent", color: "var(--ink2)" };
const tabActive: CSSProperties = { ...tabBase, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)" };
