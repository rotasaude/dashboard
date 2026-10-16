// src/modules/labAdmin/ReleasersPanel.tsx
// Liberadores do laboratório (spec §4; contrato §3): quem tem o papel
// `lab_releaser` (dado pela Equipe) é ligado ao laboratório, com as marcas de
// responsável técnico (RT) e substituto. O conselho vem do perfil profissional
// (módulo 10); sem ele, 422 council_missing. Trocar a marca = tirar e incluir.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addLabReleaser, listLabReleasers, listMemberships, removeLabReleaser, type LabReleaser } from "../../lib/api";
import { LAB_RELEASERS_KEY, labError } from "../../lib/lab";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { errorCode } from "../../lib/api";
import { alert, checkLabel, fieldLabel, muted, row, stack } from "../exams/styles";

type Pending = null | { kind: "add"; userId: string; email: string; lead: boolean; deputy: boolean } | { kind: "remove"; releaser: LabReleaser };

export function ReleasersPanel({ providerId, onGoToSecurity }: { providerId: string; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const releasers = useQuery({ queryKey: [ LAB_RELEASERS_KEY ], queryFn: listLabReleasers, retry: false });
  const members = useQuery({ queryKey: [ "memberships" ], queryFn: listMemberships, retry: false });
  const [ userId, setUserId ] = useState("");
  const [ lead, setLead ] = useState(false);
  const [ deputy, setDeputy ] = useState(false);
  const [ pending, setPending ] = useState<Pending>(null);
  const [ error, setError ] = useState<string | null>(null);
  const mine = (releasers.data ?? []).filter((r) => r.provider_id === providerId);
  const candidates = (members.data ?? []).filter((m) => m.role === "lab_releaser" && !mine.some((r) => r.user_id === m.user.id));
  const refresh = () => queryClient.invalidateQueries({ queryKey: [ LAB_RELEASERS_KEY ] });
  const busyElsewhere = pending !== null;
  const addError = (err: unknown) => (errorCode(err) === "not_found" ? "pessoa não encontrada ou inativa" : labError(err));
  const removeError = (err: unknown) => {
    if (errorCode(err) !== "not_found") return labError(err);
    void refresh();
    return "este liberador já foi retirado — a lista foi atualizada";
  };

  function add() {
    if (!userId) { setError("escolha a pessoa"); return; }
    if (lead && deputy) { setError("a mesma pessoa não é RT e substituto ao mesmo tempo"); return; }
    setError(null);
    const email = candidates.find((c) => c.user.id === userId)?.user.email_address ?? "";
    setPending({ kind: "add", userId, email, lead, deputy });
  }

  return (
    <Panel title="Liberadores" sub="quem assina laudos neste laboratório · RT e substituto aparecem no laudo">
      <div style={stack}>
        {releasers.isError && <p role="alert" style={alert}>{labError(releasers.error)}</p>}
        <DataTable<LabReleaser>
          cols={[
            { label: "Pessoa", w: "1.6fr", card: "title", render: (r) => `${r.name} · ${r.email}` },
            { label: "Conselho", w: "1.2fr", render: (r) => (r.council ? `${r.council}-${r.council_uf ?? "?"} ${r.council_number ?? ""}` : "—") },
            { label: "Marca", w: "1fr", render: (r) => <>{r.technical_lead && <Tag tone="accent">RT</Tag>}{r.technical_deputy && <Tag>substituto</Tag>}</> },
            { label: "", w: "auto", card: "actions", render: (r) => (
              <button type="button" style={secondaryButtonStyle} disabled={busyElsewhere} onClick={() => setPending({ kind: "remove", releaser: r })}>Tirar</button>
            ) }
          ]}
          rows={mine} rowKey={(r) => r.id} empty={releasers.isPending ? "carregando…" : "nenhum liberador neste laboratório"}
        />
        <p style={muted}>O papel de liberador é dado na Equipe; o conselho, a UF e o registro vêm do perfil em Profissionais.</p>
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>
            Pessoa com o papel de liberador
            <select value={userId} style={inputStyle} onChange={(e) => setUserId(e.target.value)}>
              <option value="">—</option>
              {candidates.map((c) => <option key={c.user.id} value={c.user.id}>{c.user.email_address}</option>)}
            </select>
          </label>
          <label style={checkLabel}><input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} />Responsável técnico (RT)</label>
          <label style={checkLabel}><input type="checkbox" checked={deputy} onChange={(e) => setDeputy(e.target.checked)} />Substituto do RT</label>
          <button type="button" style={secondaryButtonStyle} disabled={busyElsewhere} onClick={add}>Incluir liberador</button>
        </div>
        {error && <p role="alert" style={alert}>{error}</p>}
        {pending?.kind === "add" && (
          <SensitiveAction title={`Incluir liberador — ${pending.email}`}
            description={`Passa a liberar laudos deste laboratório${pending.lead ? " como responsável técnico" : pending.deputy ? " como substituto do RT" : ""}.`}
            requiresStepUp confirmLabel="Incluir"
            run={async () => { await addLabReleaser({ user_id: pending.userId, provider_id: providerId, technical_lead: pending.lead, technical_deputy: pending.deputy }); }}
            onDone={() => { setPending(null); setUserId(""); setLead(false); setDeputy(false); void refresh(); }} onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity} translateError={addError} />
        )}
        {pending?.kind === "remove" && (
          <SensitiveAction title={`Tirar liberador — ${pending.releaser.name}`} description="Deixa de liberar laudos deste laboratório; os laudos já assinados não mudam."
            requiresStepUp confirmLabel="Tirar"
            run={async () => { await removeLabReleaser(pending.releaser.id); }}
            onDone={() => { setPending(null); void refresh(); }} onCancel={() => setPending(null)} onGoToSecurity={onGoToSecurity}
            translateError={removeError} />
        )}
      </div>
    </Panel>
  );
}
