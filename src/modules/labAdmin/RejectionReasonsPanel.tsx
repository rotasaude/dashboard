// src/modules/labAdmin/RejectionReasonsPanel.tsx
// Motivos de rejeição do laboratório (spec §4; contrato §3): incluir, ativar e
// desativar (nunca apagar: amostras antigas apontam para eles). Step-up.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createRejectionReason, listRejectionReasons, updateRejectionReason, type LabRejectionReason } from "../../lib/api";
import { LAB_REASONS_KEY, labError } from "../../lib/lab";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { errorCode } from "../../lib/api";
import { alert, fieldLabel, row, stack } from "../exams/styles";

type Pending = null | { kind: "create"; name: string } | { kind: "toggle"; reason: LabRejectionReason };

export function RejectionReasonsPanel({ providerId, onGoToSecurity }: { providerId: string; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const reasons = useQuery({ queryKey: [ LAB_REASONS_KEY, "admin", providerId ], queryFn: () => listRejectionReasons(providerId), retry: false });
  const [ name, setName ] = useState("");
  const [ pending, setPending ] = useState<Pending>(null);
  const [ error, setError ] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [ LAB_REASONS_KEY ] });
  const busyElsewhere = pending !== null;
  // not_found no admin = o motivo sumiu; a tela recarrega a lista.
  const toggleError = (err: unknown) => {
    if (errorCode(err) !== "not_found") return labError(err);
    void refresh();
    return "motivo não encontrado — a lista foi atualizada";
  };

  return (
    <Panel title="Motivos de rejeição" sub="usados no recebimento; desative em vez de apagar">
      <div style={stack}>
        {reasons.isError && <p role="alert" style={alert}>{labError(reasons.error)}</p>}
        <DataTable<LabRejectionReason>
          cols={[
            { label: "Motivo", w: "2fr", card: "title", render: (r) => r.name },
            { label: "Situação", w: "1fr", render: (r) => <Tag tone={r.active ? "ok" : undefined}>{r.active ? "ativo" : "inativo"}</Tag> },
            { label: "", w: "auto", card: "actions", render: (r) => (
              <button type="button" style={secondaryButtonStyle} disabled={busyElsewhere} onClick={() => setPending({ kind: "toggle", reason: r })}>{r.active ? "Desativar" : "Ativar"}</button>
            ) }
          ]}
          rows={reasons.data ?? []} rowKey={(r) => r.id} empty={reasons.isPending ? "carregando…" : "nenhum motivo cadastrado"}
        />
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>Novo motivo<input value={name} maxLength={80} style={inputStyle} onChange={(e) => setName(e.target.value)} /></label>
          <button type="button" style={secondaryButtonStyle} disabled={busyElsewhere}
            onClick={() => { if (!name.trim()) { setError("escreva o motivo"); return; }
              if (name.trim().length > 80) { setError("motivo com até 80 caracteres"); return; } setError(null); setPending({ kind: "create", name: name.trim() }); }}>Incluir motivo</button>
        </div>
        {error && <p role="alert" style={alert}>{error}</p>}
        {pending?.kind === "create" && (
          <SensitiveAction title={`Incluir motivo — ${pending.name}`} description="O motivo passa a aparecer no recebimento." requiresStepUp confirmLabel="Incluir"
            run={async () => { await createRejectionReason({ provider_id: providerId, name: pending.name, active: true }); }}
            onDone={() => { setPending(null); setName(""); void refresh(); }} onCancel={() => setPending(null)} onGoToSecurity={onGoToSecurity}
            translateError={(err) => labError(err)} />
        )}
        {pending?.kind === "toggle" && (
          <SensitiveAction title={`${pending.reason.active ? "Desativar" : "Ativar"} motivo — ${pending.reason.name}`}
            description={pending.reason.active ? "O motivo some do recebimento; as rejeições antigas continuam com ele." : "O motivo volta ao recebimento."}
            requiresStepUp confirmLabel={pending.reason.active ? "Desativar" : "Ativar"}
            run={async () => { await updateRejectionReason(pending.reason.id, { name: pending.reason.name, active: !pending.reason.active }); }}
            onDone={() => { setPending(null); void refresh(); }} onCancel={() => setPending(null)} onGoToSecurity={onGoToSecurity}
            translateError={toggleError} />
        )}
      </div>
    </Panel>
  );
}
