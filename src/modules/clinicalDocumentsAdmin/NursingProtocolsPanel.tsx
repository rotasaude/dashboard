// src/modules/clinicalDocumentsAdmin/NursingProtocolsPanel.tsx
// Protocolos de enfermagem da cidade (módulo 19c; spec §3; contrato §6): só
// municipal_admin, com step-up. Editar cria uma versão nova (a receita de
// enfermagem guarda a versão em que saiu); a enfermagem só prescreve itens do
// protocolo vigente. api#61: "Ver versões" mostra o histórico sob demanda.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addNursingProtocolVersion, createNursingProtocol, errorCode, listNursingProtocolVersions, listNursingProtocols, type NursingProtocol,
  type NursingProtocolVersionRow
} from "../../lib/api";
import {
  PROTOCOLS_KEY, documentError, emptyProtocol, protocolDraftFrom, protocolInput, protocolVersionInput, type ProtocolDraft
} from "../../lib/clinicalDocuments";
import { todayInCity } from "../../lib/campaigns";
import { Panel } from "../../components/Panel";
import { DataTable, type Column } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ProtocolForm } from "./ProtocolForm";
import { useReveal } from "../../lib/useReveal";

type Editing = { mode: "new" } | { mode: "version"; protocol: NursingProtocol };

const FUTURE_NOTE = "A lista só mostra esta versão depois que ela começar a valer";
const PAST_NOTE = "Esta versão não vai aparecer como vigente, porque o fim da vigência já passou";
function timingNotes(d: ProtocolDraft, today: string): string[] {
  const out: string[] = [];
  if (d.validFrom > today) out.push(`${FUTURE_NOTE} (a partir de ${day(d.validFrom)}).`);
  if (d.validUntil && d.validUntil < today) out.push(`${PAST_NOTE} (${day(d.validUntil)}).`);
  return out;
}
const day = (iso: string) => iso.split("-").reverse().join("/");

// Sem vigente: a próxima só se conhece pelo histórico (lido em "Ver versões").
function validity(p: NursingProtocol, nextFrom?: string): string {
  const v = p.current_version;
  if (!v) return nextFrom ? `sem versão vigente hoje — próxima a partir de ${day(nextFrom)}` : "sem versão vigente hoje";
  return v.valid_until ? `de ${day(v.valid_from)} até ${day(v.valid_until)}` : `desde ${day(v.valid_from)}`;
}

export function NursingProtocolsPanel({ onGoToSecurity, searchDelayMs }: { onGoToSecurity?(): void; searchDelayMs?: number }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ PROTOCOLS_KEY ], queryFn: listNursingProtocols, retry: false });
  const [ editing, setEditing ] = useState<Editing | null>(null);
  const [ ready, setReady ] = useState<ProtocolDraft | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const formKey = useRef(0);
  // O último rascunho: cancelar o step-up volta ao formulário com o que foi digitado.
  const lastDraft = useRef<ProtocolDraft | null>(null);
  const today = todayInCity();
  const [ viewing, setViewing ] = useState<NursingProtocol | null>(null);
  const [ nextFrom, setNextFrom ] = useState<Record<string, string>>({});
  const versions = useQuery({
    queryKey: [ VERSIONS_KEY, viewing?.id ], queryFn: () => listNursingProtocolVersions(viewing!.id), enabled: viewing !== null, retry: false
  });
  useEffect(() => {
    if (!viewing || !versions.data) return;
    const next = versions.data.filter((v) => v.situation === "agendada").map((v) => v.valid_from).sort()[0];
    if (next) setNextFrom((prev) => ({ ...prev, [viewing.id]: next }));
  }, [ viewing, versions.data ]);

  function start(next: Editing) {
    formKey.current += 1;
    lastDraft.current = null;
    setNotice(null); setReady(null); setEditing(next);
  }

  const cols: Column<NursingProtocol>[] = [
    { label: "Protocolo", w: "2.2fr", render: (p) => p.title },
    { label: "Número e ano", w: "1.2fr", render: (p) => `nº ${p.number} · ${p.year}` },
    { label: "Vigência", w: "1.4fr", render: (p) => validity(p, nextFrom[p.id]) },
    { label: "Itens", w: "0.5fr", align: "right", render: (p) => String(p.current_version?.items.length ?? 0) },
    { label: "", w: "auto", align: "right", render: (p) => (
      <span style={{ display: "inline-flex", gap: 6 }}>
        <button type="button" aria-label={`Ver versões de ${p.title}`} style={secondaryButtonStyle}
          onClick={() => setViewing(p)}>Ver versões</button>
        <button type="button" aria-label={`Nova versão de ${p.title}`} disabled={editing !== null}
          style={editing !== null ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => start({ mode: "version", protocol: p })}>Nova versão</button>
      </span>
    ) }
  ];

  const formTitle = editing?.mode === "version" ? `Nova versão: ${editing.protocol.title}` : "Novo protocolo de enfermagem";

  return (
    <Panel title="Protocolos de enfermagem" sub="COFEN 801/2026 · a enfermagem só prescreve itens do protocolo vigente">
      <div style={body}>
        {notice && <p role="status" style={statusStyle}>{notice}</p>}
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{documentError(query.error)}</p>}
        {query.isSuccess && <DataTable cols={cols} rows={query.data} rowKey={(p) => p.id} empty="nenhum protocolo cadastrado" />}
        {viewing && (
          <VersionHistory key={viewing.id} protocol={viewing} query={versions} onClose={() => setViewing(null)} />
        )}
        {!editing && (
          <div><button type="button" style={buttonStyle} onClick={() => start({ mode: "new" })}>Novo protocolo</button></div>
        )}
        {editing && !ready && (
          <ProtocolForm key={formKey.current} title={formTitle} withHeader={editing.mode === "new"} searchDelayMs={searchDelayMs}
            initial={lastDraft.current ?? (editing.mode === "new" ? emptyProtocol(today) : protocolDraftFrom(editing.protocol, today))}
            onReady={(d) => { lastDraft.current = d; setReady(d); }} onCancel={() => setEditing(null)} />
        )}
        {editing && ready && (
          <SensitiveAction
            title={editing.mode === "new" ? `Criar o protocolo: ${ready.title.trim()}` : `Nova versão: ${editing.protocol.title}`}
            description={(
              <>
                <p style={muted}>Editar cria uma versão nova; as receitas já emitidas guardam a versão em que saíram.</p>
                {timingNotes(ready, today).map((n) => <p key={n} style={muted}>{n}</p>)}
              </>
            )}
            requiresStepUp
            confirmLabel="Salvar protocolo"
            run={async () => {
              if (editing.mode === "new") await createNursingProtocol(protocolInput(ready));
              else await addNursingProtocolVersion(editing.protocol.id, protocolVersionInput(ready));
            }}
            onDone={() => {
              lastDraft.current = null;
              setEditing(null); setReady(null);
              setNotice([ "Protocolo salvo.", ...timingNotes(ready, today) ].join(" "));
              void queryClient.invalidateQueries({ queryKey: [ PROTOCOLS_KEY ] });
            }}
            onCancel={() => setReady(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (errorCode(err) ? documentError(err) : null)}
          />
        )}
      </div>
    </Panel>
  );
}

const VERSIONS_KEY = "nursingProtocolVersions";

const SITUATION: Record<string, (v: NursingProtocolVersionRow) => string> = {
  vigente: () => "vigente", encerrada: () => "encerrada", agendada: (v) => `agendada a partir de ${day(v.valid_from)}`
};
const versionValidity = (v: NursingProtocolVersionRow) =>
  (v.valid_until ? `de ${day(v.valid_from)} a ${day(v.valid_until)}` : `a partir de ${day(v.valid_from)}`);

function VersionHistory({ protocol, query, onClose }: {
  protocol: NursingProtocol; query: { data?: NursingProtocolVersionRow[]; error: unknown; isError: boolean; isPending: boolean };
  onClose(): void;
}) {
  // Abre à vista e fecha com Escape (FC-13).
  const ref = useReveal<HTMLElement>(true);
  return (
    <section ref={ref} aria-label={`Versões: ${protocol.title}`} style={history}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <strong>{`Versões: ${protocol.title}`}</strong>
      {query.isPending && <p className="mono" style={muted}>carregando…</p>}
      {query.isError && <p role="alert" style={alert}>{documentError(query.error)}</p>}
      {query.data && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {query.data.map((v) => (
            <li key={v.id} aria-label={`Versão ${v.version}`}>
              <div style={{ fontWeight: 600 }}>{`Versão ${v.version} · ${versionValidity(v)} · ${(SITUATION[v.situation] ?? (() => v.situation))(v)}`}</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {v.items.map((i) => (
                  <li key={i.catalog_item.id} style={muted}>
                    {i.max_dose ? `${i.catalog_item.label} · dose máxima ${i.max_dose.quantity} ${i.max_dose.unit}` : i.catalog_item.label}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button></div>
    </section>
  );
}

const history: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 12.5 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
