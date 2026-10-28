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
import { fetchWeekCsv, listNotifications, type NotificationQuery } from "../lib/api";
import { usePagedNotifications } from "../hooks/usePagedNotifications";
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
            <input value={week} style={inputStyle} className="mono" placeholder="2026-42" onChange={(e) => { setWeek(e.target.value); setMessage(null); }}
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

function WithoutNumber() {
  const [ shown, setShown ] = useState(false);
  const [ openId, setOpenId ] = useState<string | null>(null);

  const list = useQuery({
    queryKey: [ NOTIFICATIONS_KEY, REPORT_KEY ], queryFn: () => listNotifications(WITHOUT_NUMBER), enabled: shown, ...NOMINAL_QUERY
  });

  const { rows, next, more, loadMore } = usePagedNotifications(list, WITHOUT_NUMBER, REPORT_KEY);

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
            {more.error && <p role="alert" style={alert}>{more.error}</p>}
            {list.data && next && (
              <div style={row}>
                <button type="button" style={more.busy ? disabledButtonStyle : buttonStyle} disabled={more.busy} onClick={() => void loadMore()}>
                  {more.busy ? "Carregando…" : "Carregar mais"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
