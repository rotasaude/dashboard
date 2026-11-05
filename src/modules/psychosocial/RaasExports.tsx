// Remessa RAAS e fichas espelho do mês de um CAPS (módulo 31, F-31.6; P4, P15, P43, R11, R12). Coordenação lotada e faturista.
// - Lista das remessas do mês (`GET /raas_exports`: competência, quando, quem, versão do layout, registros; sem nome de usuário nem
//   dado clínico). Baixar → `fetchPsyRaasFile` + `saveFile` (nome do api, ou "raas-<mês>.txt"); o api grava a trilha.
// - Gerar (step-up, P15): a coordenação só com o mês fechado (ela lê o mês); o faturista não lê o mês (P43) e vê o botão enquanto o
//   mês não tem remessa — o api recusa mês aberto (409 `month_open`) com frase. `raas_layout_unavailable` é o caminho de hoje (gate):
//   frase em `role="status"`, não erro — o caminho é a ficha espelho.
// - Fichas: coordenação e faturista em qualquer mês (R12 revisto). Com o mês aberto, a coordenação recebe a PRÉVIA (api) e o
//   faturista, 409 `month_open` com frase (P43). Duplo clique abre uma janela só.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPsyRaasExport, errorCode, fetchPsyRaasFile, listPsyRaasExports, type PsyRaasExport, type PsyUnit } from "../../lib/api";
import { competenceLabel } from "../../lib/competence";
import { fmtDateTime } from "../../lib/format";
import { monthLabel } from "../../lib/regulation";
import {
  BILLING_SHEETS_NOTE, GENERATE_RAAS_NOTE, NO_RAAS_EXPORTS, PSY_ERRORS, PSY_EXPORTS_KEY, RAAS_AFTER_CLOSE_NOTE, RAAS_DOWNLOAD_NOTE, SHEETS_PREVIEW_NOTE,
  STATIC_QUERY, isStale, psyError, raasExportedText, type PsyRoles
} from "../../lib/psychosocial";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { saveFile } from "../lab/saveFile";
import { alert, muted, okText, row, stack } from "../exams/styles";
import { openSheets } from "./openSheets";

type Notice = { text: string; ok: boolean };
// O mês mudou de situação entre a leitura e o clique: relê.
const STALE_CODES = [ "month_open", "already_exported" ];

// `monthStatus`: a situação lida pela coordenação; `null` para o faturista (não lê o mês, P43) ou enquanto a leitura não chegou.
export function RaasExports({ unit, month, roles, monthStatus, onGoToSecurity, onChanged }: {
  unit: PsyUnit; month: string; roles: PsyRoles; monthStatus: string | null; onGoToSecurity?: () => void; onChanged(): Promise<void>;
}) {
  const exports = useQuery({ queryKey: [ PSY_EXPORTS_KEY, unit.id, month ], queryFn: () => listPsyRaasExports(unit.id, month), ...STATIC_QUERY });
  const [ generating, setGenerating ] = useState(false);
  const [ notice, setNotice ] = useState<Notice | null>(null);
  const [ downloading, setDownloading ] = useState(false);
  const [ opening, setOpening ] = useState(false);
  const openingRef = useRef(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const outcome = useRef<PsyRaasExport | "layout" | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  useEffect(() => { setGenerating(false); }, [ monthStatus ]);

  const items = exports.data ?? [];
  const label = monthLabel(month);
  const lead = roles.lead;
  // Com a situação lida (coordenação), só o mês fechado; sem ela, só o faturista (a coordenação espera a leitura).
  const canGenerate = exports.isSuccess && items.length === 0 && (monthStatus !== null ? monthStatus === "closed" : roles.billing && !lead);
  const canSheets = lead || roles.billing;

  async function download(x: PsyRaasExport) {
    if (busy.current) return;
    busy.current = true;
    setDownloading(true);
    setNotice(null);
    try {
      const file = await fetchPsyRaasFile(x.id);
      saveFile(file, file.filename ?? `raas-${x.month}.txt`);
    } catch (err) {
      if (alive.current) setNotice({ text: psyError(err), ok: false });
    } finally {
      busy.current = false;
      if (alive.current) setDownloading(false);
    }
  }

  async function sheets() {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setNotice(null);
    try {
      const res = await openSheets(month, { unitId: unit.id, enrollmentId: null });
      if (!res.ok && alive.current) setNotice({ text: res.text, ok: false });
    } finally {
      openingRef.current = false;
      if (alive.current) setOpening(false);
    }
  }

  return (
    <Panel title={`Remessa e fichas de ${label}`} sub="RAAS-PSI">
      <div style={stack}>
        {notice && <p ref={noticeRef} tabIndex={-1} role={notice.ok ? "status" : "alert"} style={notice.ok ? okText : alert}>{notice.text}</p>}
        <p style={muted}>{RAAS_DOWNLOAD_NOTE}</p>
        <div style={row}>
          {canGenerate && (
            <button type="button" disabled={generating} style={generating ? disabledButtonStyle : buttonStyle}
              onClick={() => { setNotice(null); setGenerating(true); }}>Gerar remessa</button>
          )}
          {canSheets && (
            <button type="button" disabled={opening} style={opening ? disabledButtonStyle : secondaryButtonStyle}
              onClick={() => { void sheets(); }}>Fichas espelho do mês (PDF)</button>
          )}
        </div>
        {lead && monthStatus === "open" && <p style={muted}>{`${RAAS_AFTER_CLOSE_NOTE} ${SHEETS_PREVIEW_NOTE}`}</p>}
        {!lead && <p style={muted}>{BILLING_SHEETS_NOTE}</p>}
        {generating && (
          <SensitiveAction
            key="generate"
            title={`Gerar remessa de ${label}`}
            description={GENERATE_RAAS_NOTE}
            requiresStepUp
            run={async () => {
              outcome.current = null;
              try {
                outcome.current = await createPsyRaasExport(unit.id, month);
              } catch (err) {
                const code = errorCode(err) ?? "";
                // Sem layout homologado (gate): não é erro de quem pediu; o caminho é a ficha.
                if (code === "raas_layout_unavailable") { outcome.current = "layout"; return; }
                if (isStale(err) || STALE_CODES.includes(code)) void onChanged();
                throw err;
              }
            }}
            onDone={() => {
              const o = outcome.current;
              setGenerating(false);
              if (o === "layout") setNotice({ text: PSY_ERRORS.raas_layout_unavailable, ok: true });
              else if (o) { setNotice({ text: raasExportedText(o.competence), ok: true }); void onChanged(); }
            }}
            onCancel={() => setGenerating(false)}
            onGoToSecurity={onGoToSecurity}
            translateError={psyError}
          />
        )}
        {exports.isError && <p role="alert" style={alert}>{psyError(exports.error)}</p>}
        {exports.isPending ? <p className="mono" style={muted}>carregando…</p>
          : !exports.data ? null
          : (
            <DataTable<PsyRaasExport>
              cols={[
                { label: "Competência", w: "1fr", card: "title", render: (x) => `apresentação ${competenceLabel(x.competence)}` },
                { label: "Gerada em", w: "1.2fr", render: (x) => fmtDateTime(x.created_at) },
                { label: "Por", w: "1.4fr", render: (x) => x.created_by.name },
                { label: "Layout", w: "0.8fr", render: (x) => x.layout_version ?? "—" },
                { label: "Registros", w: "0.8fr", render: (x) => String(x.records_count) },
                { label: "", w: "auto", align: "right", card: "actions", render: (x) => (
                  <button type="button" disabled={downloading} style={downloading ? disabledButtonStyle : secondaryButtonStyle}
                    aria-label={`Baixar remessa de ${monthLabel(x.month)}`} onClick={() => { void download(x); }}>Baixar remessa</button>
                ) }
              ]}
              rows={items}
              rowKey={(x) => x.id}
              empty={NO_RAAS_EXPORTS}
            />
          )}
      </div>
    </Panel>
  );
}
