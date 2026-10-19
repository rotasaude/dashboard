// Exames do laboratório (contrato §3): adotar do catálogo-base (setor,
// bancada, prazo de entrega), ajustar e criar versões. Escrita com step-up,
// uma por vez (abrir uma fecha as outras). Sem polling.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adoptLabExam, getLabAdminExam, listAdminInstruments, listLabAdminExams, listLabTemplates, updateLabExam, type LabExam, type LabTemplate } from "../../lib/api";
import { QC_EXAMS_KEY } from "../../lib/qc";
import { LAB_ADMIN_EXAMS_KEY, LAB_TEMPLATES_KEY, SECTOR_LABEL, labError, refreshLab, sectorLabel } from "../../lib/lab";
import { fmtDateTime } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { hasFeature } from "../../lib/features";
import { QC_INSTRUMENTS_KEY, qcError } from "../../lib/qc";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { ActionButton } from "../../components/ActionButton";
import { SensitiveAction } from "../../components/SensitiveAction";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { VersionForm } from "./VersionForm";
import { alert, fieldLabel, list, muted, row, stack } from "../exams/styles";

interface Settings { sector: string; bench: string; deliveryDays: string; active: boolean }
const NEW_SETTINGS: Settings = { sector: "", bench: "", deliveryDays: "2", active: true };

export function LabExamsPanel({ providerId, onGoToSecurity }: { providerId: string; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // 21c: aparelho da versão só com o CIQ ou o estoque ligados (Divergência C13).
  const instrumentsOn = hasFeature(user, "lab_quality_control") || hasFeature(user, "lab_inventory");
  const instruments = useQuery({
    queryKey: [ QC_INSTRUMENTS_KEY, providerId, "admin" ], queryFn: () => listAdminInstruments(providerId), enabled: instrumentsOn, retry: false
  });
  const exams = useQuery({ queryKey: [ LAB_ADMIN_EXAMS_KEY, providerId ], queryFn: () => listLabAdminExams(providerId), retry: false });
  const templates = useQuery({ queryKey: [ LAB_TEMPLATES_KEY ], queryFn: listLabTemplates, retry: false });
  const [ adopting, setAdopting ] = useState<LabTemplate | null>(null);
  const [ editing, setEditing ] = useState<LabExam | null>(null);
  const [ versioning, setVersioning ] = useState<LabExam | null>(null);
  const [ settings, setSettings ] = useState<Settings>(NEW_SETTINGS);
  const [ confirm, setConfirm ] = useState<null | "adopt" | "edit">(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const adopted = new Set((exams.data ?? []).map((e) => e.template_id));
  const refresh = () => {
    void refreshLab(queryClient).catch(() => undefined);
    // A lista de exames do CIQ/CEQ/estoque (21c) é outra consulta: adotar exame ou criar versão a muda.
    void queryClient.invalidateQueries({ queryKey: [ QC_EXAMS_KEY ] }).catch(() => undefined);
  };

  function closeAll() { setAdopting(null); setEditing(null); setVersioning(null); setConfirm(null); setError(null); setNotice(null); }

  function check(): boolean {
    if (!settings.sector) { setError("escolha o setor"); return false; }
    if (!/^\d{1,2}$/.test(settings.deliveryDays.trim()) || Number(settings.deliveryDays) < 1 || Number(settings.deliveryDays) > 90) {
      setError("prazo de entrega em dias inteiros (1 a 90)"); return false;
    }
    if (settings.bench.trim().length > 60) { setError("bancada com até 60 caracteres"); return false; }
    setError(null);
    return true;
  }

  async function openVersion(e: LabExam) {
    closeAll();
    try { setVersioning(await getLabAdminExam(e.id)); } catch (err) { setError(labError(err)); }
  }

  const settingsFields = (
    <fieldset disabled={confirm !== null} style={{ ...row, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <label style={fieldLabel}>Setor
        <select value={settings.sector} style={inputStyle} onChange={(e) => setSettings((s) => ({ ...s, sector: e.target.value }))}>
          <option value="">—</option>
          {Object.entries(SECTOR_LABEL).map(([ k, v ]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label style={fieldLabel}>Bancada<input value={settings.bench} maxLength={60} style={inputStyle} onChange={(e) => setSettings((s) => ({ ...s, bench: e.target.value }))} /></label>
      <label style={fieldLabel}>Prazo de entrega (dias, 1 a 90)<input value={settings.deliveryDays} inputMode="numeric" style={inputStyle} onChange={(e) => setSettings((s) => ({ ...s, deliveryDays: e.target.value }))} /></label>
    </fieldset>
  );

  return (
    <Panel title="Exames do laboratório" sub="adotados do catálogo-base; cada ajuste de componente vira uma versão nova">
      <div style={stack}>
        {notice && <p role="status" style={muted}>{notice}</p>}
        {exams.isError && <p role="alert" style={alert}>{labError(exams.error)}</p>}
        <DataTable<LabExam>
          cols={[
            { label: "Exame", w: "1.6fr", card: "title", render: (e) => e.name },
            { label: "Setor", w: "1fr", render: (e) => `${sectorLabel(e.sector)}${e.bench ? ` · ${e.bench}` : ""}` },
            { label: "Versão", w: "0.6fr", render: (e) => (e.current_version ? `v${e.current_version.version}` : "—") },
            { label: "Prazo", w: "0.6fr", render: (e) => `${e.delivery_days} d` },
            { label: "Situação", w: "0.8fr", render: (e) => <Tag tone={e.active ? "ok" : undefined}>{e.active ? "ativo" : "inativo"}</Tag> },
            { label: "", w: "auto", card: "actions", render: (e) => (
              <div style={row}>
                <button type="button" style={secondaryButtonStyle} onClick={() => {
                  closeAll(); setEditing(e); setSettings({ sector: e.sector, bench: e.bench ?? "", deliveryDays: String(e.delivery_days), active: e.active });
                }}>Ajustar</button>
                <ActionButton variant="secondary" onClick={() => openVersion(e)}>Nova versão</ActionButton>
              </div>
            ) }
          ]}
          rows={exams.data ?? []} rowKey={(e) => e.id} empty={exams.isPending ? "carregando…" : "nenhum exame adotado"}
        />
        {versioning && (
          <>
            <ul aria-label={`versões de ${versioning.name}`} style={list}>
              {(versioning.versions ?? []).map((v) => <li key={v.id}>{`v${v.version} · ${fmtDateTime(v.created_at)}${v.created_by ? ` · ${v.created_by}` : ""}`}</li>)}
            </ul>
            {instrumentsOn && instruments.isError && (
              <div style={row}>
                <p role="alert" style={alert}>{qcError(instruments.error)}</p>
                <button type="button" style={secondaryButtonStyle} onClick={() => { void instruments.refetch(); }}>Tentar de novo</button>
              </div>
            )}
            {instrumentsOn && instruments.isPending && <p className="mono" style={muted}>carregando aparelhos…</p>}
            {(!instrumentsOn || instruments.data) && (
              <VersionForm key={versioning.id} exam={versioning} onStale={refresh} instruments={instrumentsOn ? instruments.data : undefined}
                onGoToSecurity={onGoToSecurity} onCancel={() => setVersioning(null)}
                onSaved={() => { setVersioning(null); setNotice("Versão nova criada."); refresh(); }} />
            )}
          </>
        )}
        {editing && (
          <div style={stack}>
            <strong>{`Ajustar ${editing.name}`}</strong>
            {settingsFields}
            <label style={{ ...fieldLabel, flexDirection: "row", gap: 6 }}>
              <input type="checkbox" disabled={confirm !== null} checked={settings.active} onChange={(e) => setSettings((s) => ({ ...s, active: e.target.checked }))} />Ativo
            </label>
            {confirm !== "edit" && <div style={row}>
              <button type="button" style={secondaryButtonStyle} onClick={() => { if (check()) setConfirm("edit"); }}>Salvar ajuste</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => { setEditing(null); setError(null); }}>Cancelar</button>
            </div>}
            {confirm === "edit" && (
              <SensitiveAction title={`Ajustar ${editing.name}`} description="Setor, bancada, prazo e situação. Componentes e referências mudam só por versão nova."
                requiresStepUp confirmLabel="Salvar"
                run={async () => { await updateLabExam(editing.id, { sector: settings.sector, bench: settings.bench.trim() || null, delivery_days: Number(settings.deliveryDays), active: settings.active }); }}
                onDone={() => { setConfirm(null); setEditing(null); setNotice("Ajuste salvo."); refresh(); }} onCancel={() => setConfirm(null)} onGoToSecurity={onGoToSecurity}
                translateError={(err) => labError(err)} />
            )}
          </div>
        )}
        <strong>Catálogo-base da plataforma</strong>
        {templates.isError && <p role="alert" style={alert}>{labError(templates.error)}</p>}
        <DataTable<LabTemplate>
          cols={[
            { label: "Exame", w: "1.6fr", card: "title", render: (t) => t.name },
            { label: "SIGTAP", w: "1fr", render: (t) => <span className="mono">{t.sigtap_code}</span> },
            { label: "Setor", w: "1fr", render: (t) => sectorLabel(t.sector) },
            { label: "Componentes", w: "0.8fr", align: "right", render: (t) => String(t.analytes.length) },
            { label: "", w: "auto", card: "actions", render: (t) => (adopted.has(t.id) ? <Tag tone="ok">adotado</Tag> : (
              <button type="button" style={secondaryButtonStyle} onClick={() => { closeAll(); setAdopting(t); setSettings({ ...NEW_SETTINGS, sector: t.sector }); }}>Adotar</button>
            )) }
          ]}
          rows={templates.data ?? []} rowKey={(t) => t.id} empty={templates.isPending ? "carregando…" : "catálogo-base vazio"}
        />
        {adopting && (
          <div style={stack}>
            <strong>{`Adotar ${adopting.name}`}</strong>
            <p style={muted}>A referência de partida é do catálogo-base: ajuste ao método do seu laboratório criando uma versão nova.</p>
            {settingsFields}
            {confirm !== "adopt" && <div style={row}>
              <button type="button" style={secondaryButtonStyle} onClick={() => { if (check()) setConfirm("adopt"); }}>Adotar exame</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => { setAdopting(null); setError(null); }}>Cancelar</button>
            </div>}
            {confirm === "adopt" && (
              <SensitiveAction title={`Adotar ${adopting.name}`} description="O exame entra no laboratório com a versão 1 copiada do catálogo-base."
                requiresStepUp confirmLabel="Adotar"
                run={async () => { await adoptLabExam({ provider_id: providerId, template_id: adopting.id, sector: settings.sector, bench: settings.bench.trim() || null, delivery_days: Number(settings.deliveryDays) }); }}
                onDone={() => { setConfirm(null); setAdopting(null); setNotice("Exame adotado."); refresh(); }} onCancel={() => setConfirm(null)}
                onGoToSecurity={onGoToSecurity} translateError={(err) => labError(err)} />
            )}
          </div>
        )}
        {error && <p role="alert" style={alert}>{error}</p>}
      </div>
    </Panel>
  );
}
