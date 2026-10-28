// SurveillanceReports — relatórios da vigilância (módulo 25; F-25.7; contrato K7).
// 1) CSV por semana epidemiológica: abre na semana anterior à de hoje; a semana
// em curso também vale (weekProblem), depois dela não. O arquivo traz a semana
// da suspeita, sem CPF e com CNS mascarado, e o nome não leva dado pessoal
// (notificacoes-AAAA-SS.csv). O api grava a leitura em lista na trilha.
// 2) Encerradas sem número oficial: lista nominal (grava trilha) que só lê no
// clique e nunca relê sozinha (NOMINAL_QUERY). "Abrir" leva ao detalhe, onde
// estão o PDF e o "Registrar número oficial".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWeekCsv, listNotifications, type NotificationQuery, type SurveillanceNotification } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { NOMINAL_QUERY, NOTIFICATIONS_KEY, previousEpiWeek, surveillanceError, weekLabel, weekProblem } from "../lib/surveillance";
import { Panel } from "../components/Panel";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";
import { NotificationTable } from "./surveillance/NotificationTable";
import { NotificationDetail } from "./surveillance/NotificationDetail";
import { saveFile } from "./lab/saveFile";

const WITHOUT_NUMBER: NotificationQuery = { withoutOfficialNumber: true };
const REPORT_KEY = "without-number";

export function SurveillanceReports({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Relatórios da vigilância" sub="CSV por semana e encerradas sem número oficial" allow={(r) => r.surveillance}>
      {() => (
        <div style={stack}>
          <WeekCsv today={today} />
          <WithoutNumber />
        </div>
      )}
    </SurveillanceGate>
  );
}

function WeekCsv({ today }: { today: string }) {
  const [ week, setWeek ] = useState(previousEpiWeek(today));
  const [ message, setMessage ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  async function download() {
    if (busy) return;
    const wanted = week.trim();
    const problem = weekProblem(wanted, today);
    if (problem) { setMessage(problem); return; }
    setBusy(true); setMessage(null);
    try {
      const file = await fetchWeekCsv(wanted);
      saveFile(file, file.filename ?? `notificacoes-${wanted}.csv`);
    } catch (err) {
      setMessage(surveillanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="CSV por semana epidemiológica">
      <div style={{ ...stack, padding: 16 }}>
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>
            Semana (AAAA-SS)
            <input value={week} style={inputStyle} className="mono" placeholder="2026-42" onChange={(e) => setWeek(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void download(); }} />
          </label>
          <button type="button" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy} onClick={() => void download()}>
            {busy ? "Baixando…" : "Baixar CSV"}
          </button>
        </div>
        {weekProblem(week.trim(), today) === null && <p className="mono" style={muted}>{weekLabel(week.trim())}</p>}
        <p style={muted}>Sem CPF; CNS mascarado.</p>
        {message && <p role="alert" style={alert}>{message}</p>}
      </div>
    </Panel>
  );
}

// A linha pode repetir entre páginas (a ordem é por prazo, não por id): a primeira vez vale.
function uniqueById(rows: SurveillanceNotification[]): SurveillanceNotification[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

// Páginas extras valem só para a leitura (dataUpdatedAt) que as pediu.
interface Extra { token: number; rows: SurveillanceNotification[]; next: string | null }

function WithoutNumber() {
  const [ shown, setShown ] = useState(false);
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ extra, setExtra ] = useState<Extra | null>(null);
  const [ moreBusy, setMoreBusy ] = useState(false);
  const [ moreError, setMoreError ] = useState<string | null>(null);

  const list = useQuery({
    queryKey: [ NOTIFICATIONS_KEY, REPORT_KEY ], queryFn: () => listNotifications(WITHOUT_NUMBER), enabled: shown, ...NOMINAL_QUERY
  });

  const token = list.dataUpdatedAt;
  const liveExtra = extra && extra.token === token ? extra : null;
  const rows = uniqueById([ ...(list.data?.notifications ?? []), ...(liveExtra?.rows ?? []) ]);
  const next = liveExtra ? liveExtra.next : list.data?.next_before ?? null;

  async function loadMore() {
    if (!next || moreBusy) return;
    const asked = token;
    setMoreBusy(true); setMoreError(null);
    try {
      const page = await listNotifications({ ...WITHOUT_NUMBER, before: next });
      setExtra((prev) => ({ token: asked, rows: [ ...(prev && prev.token === asked ? prev.rows : []), ...page.notifications ], next: page.next_before }));
    } catch (err) {
      setMoreError(surveillanceError(err));
    } finally {
      setMoreBusy(false);
    }
  }

  return (
    <Panel title="Encerradas sem número oficial">
      <div style={{ ...stack, padding: 16 }}>
        {!shown && (
          <>
            <p style={muted}>A lista mostra o nome das pessoas e fica registrada na trilha de acesso.</p>
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={() => setShown(true)}>Mostrar a lista</button>
            </div>
          </>
        )}
        {shown && (
          <>
            {openId && <NotificationDetail key={openId} id={openId} onClose={() => setOpenId(null)} />}
            {list.isPending && <p className="mono" style={muted}>carregando…</p>}
            {list.isError && <p role="alert" style={alert}>{surveillanceError(list.error)}</p>}
            {list.data && <NotificationTable rows={rows} onOpen={setOpenId} />}
            {moreError && <p role="alert" style={alert}>{moreError}</p>}
            {list.data && next && (
              <div style={row}>
                <button type="button" style={moreBusy ? disabledButtonStyle : buttonStyle} disabled={moreBusy} onClick={() => void loadMore()}>
                  {moreBusy ? "Carregando…" : "Carregar mais"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
