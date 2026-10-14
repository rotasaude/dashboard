// src/modules/examsAdmin/CatalogPanel.tsx
// Catálogo de exames da cidade (spec §4; contrato §5). Toda escrita com
// step-up. O formulário fica montado (escondido) durante a confirmação: uma
// recusa do api (sigtap_unknown, duplicate_sigtap) volta ao rascunho intacto.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createCatalogItem, errorCode, listCatalogItems, updateCatalogItem, type ExamCatalogItem, type ExamCatalogItemInput } from "../../lib/api";
import {
  EXAM_ADMIN_CATALOG_KEY, EXAM_CATALOG_KEY, deadlinesSummary, examError, releasePolicyLabel
} from "../../lib/exams";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CatalogItemForm } from "./CatalogItemForm";
import { alert, muted, okText } from "../exams/styles";

type Editing = { item: ExamCatalogItem | null };
type Confirming = { item: ExamCatalogItem | null; input: ExamCatalogItemInput };

export function CatalogPanel({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ EXAM_ADMIN_CATALOG_KEY ], queryFn: listCatalogItems, retry: false });
  const [ editing, setEditing ] = useState<Editing | null>(null);
  const [ confirming, setConfirming ] = useState<Confirming | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  function review(input: ExamCatalogItemInput) {
    setConfirming({ item: editing?.item ?? null, input });
  }

  function saved() {
    setNotice("Catálogo atualizado.");
    setConfirming(null);
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: [ EXAM_ADMIN_CATALOG_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ EXAM_CATALOG_KEY ] });
  }

  return (
    <Panel title="Catálogo de exames" sub="o que a cidade acompanha · prazos em dias: autorização · agendamento · coleta · resultado · ciência">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{examError(query.error)}</p>}
        {query.isSuccess && (
          <DataTable<ExamCatalogItem>
            cols={[
              { label: "SIGTAP", w: "1fr", render: (i) => <span className="mono">{i.sigtap_code}</span> },
              { label: "Exame", w: "1.8fr", card: "title", render: (i) => i.label },
              { label: "Autorização", w: "0.9fr", render: (i) => (i.requires_authorization ? "exige" : "não") },
              { label: "Liberação", w: "1.1fr", render: (i) => releasePolicyLabel(i.release_policy) },
              { label: "Prazos", w: "1.3fr", render: (i) => <span className="mono">{deadlinesSummary(i.deadlines)}</span> },
              { label: "Campos", w: "0.6fr", align: "right", render: (i) => String(i.result_fields.length) },
              { label: "Situação", w: "0.8fr", render: (i) => <Tag tone={i.active ? "ok" : "neutral"}>{i.active ? "ativo" : "inativo"}</Tag> },
              { label: "", w: "auto", align: "right", card: "actions", render: (i) => (
                <button type="button" aria-label={`Editar ${i.label}`} style={secondaryButtonStyle} disabled={editing !== null}
                  onClick={() => { setNotice(null); setEditing({ item: i }); }}>Editar</button>
              ) }
            ]}
            rows={query.data} rowKey={(i) => i.id} empty="nenhum exame no catálogo"
          />
        )}
        {query.isSuccess && editing === null && (
          <div><button type="button" style={buttonStyle} onClick={() => { setNotice(null); setEditing({ item: null }); }}>Novo exame</button></div>
        )}
        {editing && (
          <div hidden={confirming !== null}>
            <CatalogItemForm key={editing.item?.id ?? "new"} initial={editing.item ?? undefined} onReview={review} onCancel={() => setEditing(null)} />
          </div>
        )}
        {confirming && (
          <SensitiveAction
            title={confirming.item ? `Salvar ${confirming.item.label}` : `Incluir o exame ${confirming.input.sigtap_code}`}
            description={`${confirming.input.requires_authorization ? "Exige autorização" : "Sem autorização"} · liberação: ${releasePolicyLabel(confirming.input.release_policy)} · ${confirming.input.result_fields.length} campos de resultado.`}
            requiresStepUp
            confirmLabel="Salvar exame"
            run={async () => {
              if (confirming.item) await updateCatalogItem(confirming.item.id, confirming.input);
              else await createCatalogItem(confirming.input);
            }}
            onDone={saved}
            onCancel={() => setConfirming(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (errorCode(err) ? examError(err) : null)}
          />
        )}
      </div>
    </Panel>
  );
}
