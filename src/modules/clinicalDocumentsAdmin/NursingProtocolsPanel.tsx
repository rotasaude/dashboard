// src/modules/clinicalDocumentsAdmin/NursingProtocolsPanel.tsx
// Protocolos de enfermagem da cidade (módulo 19c; spec §3; contrato §6): só
// municipal_admin, com step-up. Editar cria uma versão nova (a receita de
// enfermagem guarda a versão em que saiu); a enfermagem só prescreve itens do
// protocolo vigente.
import { useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addNursingProtocolVersion, createNursingProtocol, errorCode, listNursingProtocols, type NursingProtocol } from "../../lib/api";
import {
  PROTOCOLS_KEY, documentError, emptyProtocol, protocolDraftFrom, protocolInput, protocolVersionInput, type ProtocolDraft
} from "../../lib/clinicalDocuments";
import { todayInCity } from "../../lib/campaigns";
import { Panel } from "../../components/Panel";
import { DataTable, type Column } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ProtocolForm } from "./ProtocolForm";

type Editing = { mode: "new" } | { mode: "version"; protocol: NursingProtocol };

const FUTURE_NOTE = "A lista só mostra esta versão depois que ela começar a valer";
const day = (iso: string) => iso.split("-").reverse().join("/");

function validity(p: NursingProtocol): string {
  const v = p.current_version;
  if (!v) return "sem versão vigente hoje";
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

  function start(next: Editing) {
    formKey.current += 1;
    lastDraft.current = null;
    setNotice(null); setReady(null); setEditing(next);
  }

  const cols: Column<NursingProtocol>[] = [
    { label: "Protocolo", w: "2.2fr", render: (p) => p.title },
    { label: "Número e ano", w: "1.2fr", render: (p) => `nº ${p.number} · ${p.year}` },
    { label: "Vigência", w: "1.4fr", render: (p) => validity(p) },
    { label: "Itens", w: "0.5fr", align: "right", render: (p) => String(p.current_version?.items.length ?? 0) },
    { label: "", w: "auto", align: "right", render: (p) => (
      <button type="button" aria-label={`Nova versão de ${p.title}`} style={secondaryButtonStyle}
        onClick={() => start({ mode: "version", protocol: p })}>Nova versão</button>
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
                {ready.validFrom > today && (
                  <p style={muted}>{`${FUTURE_NOTE} (a partir de ${day(ready.validFrom)}).`}</p>
                )}
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
              setNotice(ready.validFrom > today ? `Protocolo salvo. ${FUTURE_NOTE} (a partir de ${day(ready.validFrom)}).` : "Protocolo salvo.");
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

const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 12.5 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
