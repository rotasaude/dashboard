// "Saldo inicial" (módulo 27b; contrato §5, Q11, Q19/Q20, Q24, Q26, Q38; F-15, F-17–F-19): a cidade importa o saldo de abertura por
// planilha. Abre sem o `bnafar`, com o estoque de algum domínio (F-15). Importa o `municipal_admin` ou o `stock_keeper` do almoxarifado
// central ativo; o almoxarife só de outros locais vê a frase do `missing_role`, sem leitura. O arquivo é conferido no navegador (extensão,
// 5 MB antes de ler, cabeçalho) e vai como JSON `{ file_base64 }`, sem o nome; depois do envio ele sai do estado e o relatório abre.
// Sem pessoa além do nome de quem enviou; sem polling.
import { useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import {
  errorCode, fetchOpeningImportTemplate, listMyPharmacyLocations, listOpeningImports, uploadOpeningImport, type OpeningImportSummary
} from "../lib/api";
import { OPENING_IMPORTS_KEY, PH_OPENINGS_KEY, STATIC_QUERY } from "../lib/bnafar";
import { fmtDateTime } from "../lib/format";
import {
  BIG_CITY_ADVICE, IMPORT_ERRORS, OPENING_IMPORT_NOTE, fileProblem, headerProblem, importErrorText, importStatusView, readFirstLine
} from "../lib/openingImport";
import { featureDisabledKey } from "../lib/features";
import { PH_LOCATIONS_KEY } from "../lib/pharmacy";
import { ActionButton } from "../components/ActionButton";
import { ConfirmButton } from "../components/ConfirmButton";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, muted, row, stack, title } from "./exams/styles";
import { BnafarGate } from "./bnafar/BnafarGate";
import { saveFile } from "./lab/saveFile";
import { ImportReport } from "./openingImport/ImportReport";

const LIST_KEY = [ OPENING_IMPORTS_KEY, "list" ] as const;
const TEMPLATE_NAME = "saldo-inicial.csv";

export function OpeningImport({ onGoToSecurity }: { onGoToSecurity?: () => void }) {
  return (
    <BnafarGate title="Saldo inicial" sub="Planilha do saldo inicial, conferência e aplicação" needs="stock" allow={(r) => r.admin || r.keeper}>
      {(roles) => roles.admin
        ? <ImportBody onGoToSecurity={onGoToSecurity} />
        : <CentralKeeper><ImportBody onGoToSecurity={onGoToSecurity} /></CentralKeeper>}
    </BnafarGate>
  );
}

// O api só aceita o almoxarife do central ATIVO: os papéis por local vêm de `listMyPharmacyLocations` (o mesmo cache do LocationPick).
// Com a farmácia desligada (cidade só de vacina ou endemias) essa leitura dá 403 `feature_disabled`: a tela deixa passar e o api decide
// (o 403 `missing_role` da lista vira a mesma frase).
function CentralKeeper({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const locs = useQuery({ queryKey: [ PH_LOCATIONS_KEY, user?.id ?? null ], queryFn: listMyPharmacyLocations, enabled: !!user, ...STATIC_QUERY });
  if (locs.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (locs.isError && featureDisabledKey(locs.error) !== null) return <>{children}</>;
  if (locs.isError) return <p role="alert" style={alert}>{importErrorText(locs.error)}</p>;
  const central = locs.data.some((l) => l.kind === "central" && l.active && l.roles.includes("stock_keeper"));
  return central ? <>{children}</> : <EmptyState title={IMPORT_ERRORS.missing_role} />;
}

function ImportBody({ onGoToSecurity }: { onGoToSecurity?: () => void }) {
  const client = useQueryClient();
  const [ openId, setOpenId ] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: LIST_KEY,
    queryFn: ({ pageParam }) => listOpeningImports(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rereadList = () => void client.invalidateQueries({ queryKey: LIST_KEY });
  // Depois de cada ato: a lista e as aberturas dos locais (a planilha cria ou estorna aberturas).
  const changed = () => { rereadList(); void client.invalidateQueries({ queryKey: [ PH_OPENINGS_KEY ] }); };

  if (list.isError && errorCode(list.error) === "missing_role") return <EmptyState title={IMPORT_ERRORS.missing_role} />;
  const items = (list.data?.pages ?? []).flatMap((p) => p.items);
  return (
    <div style={stack}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{OPENING_IMPORT_NOTE}</p>
        <p style={muted}>{BIG_CITY_ADVICE}</p>
      </div>
      <TemplateButton />
      <UploadForm onUploaded={(id) => { setOpenId(id); rereadList(); }} onFailed={rereadList} />
      {openId && (
        <ImportReport key={openId} importId={openId} onGoToSecurity={onGoToSecurity} onChanged={changed} onClose={() => setOpenId(null)} />
      )}
      <section aria-label="Importações da cidade" style={stack}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <h3 style={title}>Importações da cidade</h3>
          <button type="button" style={secondaryButtonStyle} disabled={list.isFetching} onClick={() => void list.refetch()}>Atualizar</button>
        </div>
        {list.isPending && <p className="mono" style={muted}>carregando…</p>}
        {list.isError && !list.data && <p role="alert" style={alert}>{importErrorText(list.error)}</p>}
        {list.data && (
          <DataTable<OpeningImportSummary>
            label="Importações"
            cols={[
              { label: "Enviada em", w: "1fr", card: "title", render: (i) => <span className="mono">{fmtDateTime(i.created_at)}</span> },
              { label: "Situação", w: "0.8fr", render: (i) => { const s = importStatusView(i.status); return <Tag tone={s.tone}>{s.label}</Tag>; } },
              { label: "Linhas válidas", w: "0.8fr", render: (i) => <span className="mono">{`${i.rows_valid} de ${i.rows_total}`}</span> },
              { label: "Por", w: "1.2fr", render: (i) => i.uploaded_by?.name || "—" },
              { label: "", w: "auto", card: "actions", render: (i) => (
                <button type="button" style={secondaryButtonStyle} aria-pressed={openId === i.id} onClick={() => setOpenId(i.id)}>abrir</button>
              ) }
            ]}
            rows={items} rowKey={(i) => i.id} empty="nenhuma importação enviada nesta cidade"
          />
        )}
        {list.data && list.hasNextPage && (
          <div style={row}>
            <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage ? "Carregando…" : "Carregar mais importações"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function TemplateButton() {
  const [ error, setError ] = useState<string | null>(null);
  async function download() {
    setError(null);
    try {
      const file = await fetchOpeningImportTemplate();
      saveFile(file, file.filename ?? TEMPLATE_NAME);
    } catch (err) {
      setError(importErrorText(err));
    }
  }
  return (
    <div style={row}>
      <ActionButton variant="secondary" onClick={download}>Baixar o modelo</ActionButton>
      {error && <p role="alert" style={alert}>{error}</p>}
    </div>
  );
}

// A planilha só vive aqui: conferida antes (nada sai se recusada), enviada no "enviar e conferir" e solta depois do envio.
function UploadForm({ onUploaded, onFailed }: { onUploaded(id: string): void; onFailed(): void }) {
  const [ file, setFile ] = useState<File | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ inputKey, setInputKey ] = useState(0);
  const [ sending, setSending ] = useState(false);
  const checking = useRef(0);

  async function choose(chosen: File | null) {
    const seq = ++checking.current;
    setFile(null); setError(null);
    // O tamanho antes de ler: acima do teto nada é lido.
    let found = fileProblem(chosen);
    if (!found && chosen) {
      try { found = headerProblem(await readFirstLine(chosen)); } catch { found = IMPORT_ERRORS.invalid_file; }
    }
    if (seq !== checking.current) return;
    setProblem(found);
    if (!found) setFile(chosen);
  }

  async function send() {
    if (!file) return;
    setError(null);
    setSending(true);
    try {
      const sent = await uploadOpeningImport(file);
      setFile(null); setProblem(null); setInputKey((k) => k + 1);
      onUploaded(sent.id);
    } catch (err) {
      // Nada é reenviado sozinho; a lista é relida (o envio pode ter chegado ao api antes da queda da rede).
      setError(importErrorText(err));
      onFailed();
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-label="Enviar a planilha" style={box}>
      <h3 style={title}>Enviar a planilha</h3>
      <label style={fieldLabel}>
        Planilha (.csv separado por ponto e vírgula, até 5 MB)
        <input key={inputKey} type="file" accept=".csv,text/csv" aria-label="Planilha do saldo inicial" disabled={sending}
          onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
      </label>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {file && (
        <div style={row}>
          <ConfirmButton label="enviar e conferir" variant="primary" question="Enviar a planilha para a conferência? Nada entra no estoque antes de aplicar."
            onConfirm={send} />
        </div>
      )}
    </section>
  );
}
