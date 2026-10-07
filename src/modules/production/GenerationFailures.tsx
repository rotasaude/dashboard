// "Fichas que não puderam ser geradas" (módulo 18; spec §5; contratos §6): a
// escuta concluída sem identificação completa não vira ficha; aqui aparece o
// motivo, e o municipal_admin pede "gerar de novo" (step-up) depois de
// corrigir a origem (CNES da unidade, equipe do profissional, cadastro).
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listGenerationFailures, retryGenerationFailure, type GenerationFailure } from "../../lib/api";
import {
  ALREADY_RESOLVED, SOURCE_LABEL, canRetryGeneration, productionError, productionErrorCode, reasonsLabel, retryOutcome
} from "../../lib/production";
import { featureDisabledKey } from "../../lib/features";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { secondaryButtonStyle } from "../../components/formStyles";

export const GENERATION_FAILURES_KEY = "productionGenerationFailures";

export function GenerationFailures({ roles, onGoToSecurity }: { roles: string[]; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ GENERATION_FAILURES_KEY ], queryFn: listGenerationFailures });
  const [ retrying, setRetrying ] = useState<GenerationFailure | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const outcome = useRef<GenerationFailure | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [ GENERATION_FAILURES_KEY ] });
  const canRetry = canRetryGeneration(roles);

  return (
    <Panel title="Fichas que não puderam ser geradas" sub="falta identificação na origem">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {done && <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{done}</p>}
        {query.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{productionError(query.error)}</p>}
        {retrying && (
          <SensitiveAction
            key={retrying.id}
            title="Gerar a ficha de novo"
            description="Confira antes se o motivo foi corrigido na origem. Se ainda faltar algo, a ficha continua nesta lista."
            requiresStepUp
            confirmLabel="Gerar de novo"
            run={async () => { outcome.current = await retryGenerationFailure(retrying.id); }}
            onDone={() => {
              setRetrying(null);
              setDone(outcome.current ? retryOutcome(outcome.current) : null);
              refresh();
            }}
            onCancel={() => setRetrying(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => {
              const code = productionErrorCode(err);
              if (featureDisabledKey(err) !== null) { refresh(); return productionError(err); }
              if (code !== "already_resolved") return null;
              refresh();
              return ALREADY_RESOLVED;
            }}
          />
        )}
        {query.isPending ? (
          <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
        ) : (
          <DataTable<GenerationFailure>
            cols={[
              { label: "Origem", w: "1fr", render: (f) => SOURCE_LABEL[f.source_type] ?? f.source_type },
              { label: "Motivo", w: "3fr", render: (f) => reasonsLabel(f.reason_codes) },
              { label: "Desde", w: "1fr", render: (f) => fmtDateTime(f.created_at) },
              { label: "", w: "auto", align: "right", render: (f) => canRetry && (
                <button type="button" aria-label={`Gerar de novo ${f.id}`} style={secondaryButtonStyle}
                  onClick={() => { setDone(null); setRetrying(f); }}>
                  Gerar de novo
                </button>
              ) }
            ]}
            rows={query.data ?? []}
            rowKey={(f) => f.id}
            empty="nenhuma ficha pendente de identificação"
          />
        )}
      </div>
    </Panel>
  );
}
