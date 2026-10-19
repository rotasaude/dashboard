// Materiais de controle (contrato §3): nome, fabricante, níveis e analitos
// (dos exames do laboratório). Gravar exige step-up (C-E39). Com lote, os
// níveis e os analitos já usados ficam travados (save_material.rb); a mesma
// chave de analito não entra em dois exames (C-E12).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createQcMaterial, listQcMaterials, updateQcMaterial, type LabExamRef, type QcMaterial } from "../../lib/api";
import {
  EMPTY_MATERIAL, QC_MATERIALS_KEY, analyteName, analyteToken, materialBody, materialDraft, materialProblem, qcError, refreshQc, staleAware, tokenToAnalyte,
  type MaterialDraft
} from "../../lib/qc";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, fieldset, form, legend, muted, okText, row, stack } from "../exams/styles";

export function MaterialsPanel({ providerId, exams, onGoToSecurity }: { providerId: string; exams: LabExamRef[]; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const materials = useQuery({ queryKey: [ QC_MATERIALS_KEY, providerId ], queryFn: () => listQcMaterials(providerId), retry: false });
  const [ editing, setEditing ] = useState<QcMaterial | "new" | null>(null);
  const [ draft, setDraft ] = useState<MaterialDraft>(EMPTY_MATERIAL);
  const [ confirming, setConfirming ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const set = (patch: Partial<MaterialDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const original = editing && editing !== "new" ? editing : undefined;
  const locked = original?.has_lots === true;
  const options = exams.filter((e) => e.id).flatMap((e) => (e.analytes ?? []).map((a) => ({ token: `${e.id}:${a.key}`, label: `${a.name} (${e.name})` })));
  // Analito já gravado cujo exame não está mais na lista: continua visível (e, com lote, travado).
  for (const a of original?.analytes ?? []) {
    const token = analyteToken(a);
    if (!options.some((o) => o.token === token)) options.push({ token, label: analyteName(exams, a.lab_exam_id, a.analyte_key) });
  }
  const savedTokens = new Set((original?.analytes ?? []).map(analyteToken));
  const pickedKeys = new Map(draft.analytes.map((t) => [ tokenToAnalyte(t).analyte_key, t ]));

  // 404/409: a frase diz que a tela foi atualizada, então relê de fato.
  const failed = staleAware([ "not_found", "invalid_transition" ], () => { void refreshQc(queryClient).catch(() => undefined); });

  function open(target: QcMaterial | "new") {
    setEditing(target);
    setDraft(target === "new" ? EMPTY_MATERIAL : materialDraft(target));
    setConfirming(false); setError(null); setNotice(null);
  }

  function review() {
    const problem = materialProblem(draft, original);
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  function toggle(token: string, on: boolean) {
    setDraft((d) => ({ ...d, analytes: on ? [ ...d.analytes, token ] : d.analytes.filter((t) => t !== token) }));
  }

  return (
    <Panel title="Materiais de controle" sub="níveis e analitos de cada material"
      right={<button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Novo material</button>}>
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {materials.isError ? <p role="alert" style={alert}>{qcError(materials.error)}</p> : (
          <DataTable<QcMaterial>
            cols={[
              { label: "Material", w: "1.4fr", card: "title", render: (m) => (m.manufacturer ? `${m.name} · ${m.manufacturer}` : m.name) },
              { label: "Níveis", w: "1fr", render: (m) => m.levels.join(", ") },
              { label: "Analitos", w: "1.6fr", render: (m) => m.analytes.map((a) => analyteName(exams, a.lab_exam_id, a.analyte_key)).join(", ") },
              { label: "Situação", w: "0.7fr", render: (m) => <Tag tone={m.active ? "ok" : undefined}>{m.active ? "ativo" : "inativo"}</Tag> },
              { label: "", w: "auto", card: "actions", render: (m) => <button type="button" style={secondaryButtonStyle} onClick={() => open(m)}>Editar</button> }
            ]}
            rows={materials.data ?? []} rowKey={(m) => m.id} empty={materials.isPending ? "carregando…" : "nenhum material cadastrado"}
          />
        )}
        {editing && (
          <section aria-label={editing === "new" ? "Novo material" : `Editar ${editing.name}`} style={box}>
            <div style={form}>
              <fieldset disabled={confirming} style={{ ...form, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <label style={fieldLabel}>Nome<input value={draft.name} style={inputStyle} onChange={(e) => set({ name: e.target.value })} /></label>
                <label style={fieldLabel}>Fabricante<input value={draft.manufacturer} style={inputStyle} onChange={(e) => set({ manufacturer: e.target.value })} /></label>
                <label style={fieldLabel}>Níveis (separados por ;)
                  <input value={draft.levels} placeholder="normal; patológico" style={inputStyle} disabled={locked} onChange={(e) => set({ levels: e.target.value })} />
                </label>
                {locked && <p style={muted}>o material já tem lote: os níveis e os analitos já usados não mudam; só dá para acrescentar analitos</p>}
                <fieldset style={fieldset}>
                  <legend style={legend}>Analitos</legend>
                  {options.length === 0 && <p style={muted}>nenhum exame com componentes no laboratório — adote os exames em Exames e liberadores do laboratório</p>}
                  {options.map((o) => {
                    const key = tokenToAnalyte(o.token).analyte_key;
                    const checked = draft.analytes.includes(o.token);
                    const other = pickedKeys.get(key);
                    const taken = !checked && other !== undefined && other !== o.token; // C-E12
                    return (
                      <label key={o.token} style={checkLabel}>
                        <input type="checkbox" checked={checked} disabled={taken || (locked && savedTokens.has(o.token))}
                          onChange={(e) => toggle(o.token, e.target.checked)} />{o.label}
                      </label>
                    );
                  })}
                </fieldset>
                <label style={checkLabel}><input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />Ativo</label>
              </fieldset>
            </div>
            {error && <p role="alert" style={alert}>{error}</p>}
            {!confirming && (
              <div style={row}>
                <button type="button" style={buttonStyle} onClick={review}>Revisar e salvar material</button>
                <button type="button" style={secondaryButtonStyle} onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            )}
            {confirming && (
              <SensitiveAction title="Salvar material" description="O material e seus analitos ficam disponíveis para os lotes e as referências do CIQ."
                requiresStepUp confirmLabel="Salvar material"
                run={async () => {
                  const body = materialBody(draft, providerId);
                  if (original) await updateQcMaterial(original.id, body); else await createQcMaterial(body);
                }}
                onDone={() => { setConfirming(false); setEditing(null); setNotice("Material salvo."); void refreshQc(queryClient).catch(() => undefined); }}
                onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={failed} />
            )}
          </section>
        )}
      </div>
    </Panel>
  );
}
