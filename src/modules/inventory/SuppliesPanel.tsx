// Itens de estoque (spec §6.1; contrato §5): unidade, mínimo, rendimento em
// testes (reagente), aviso de vencimento e exames ligados. Só o admin
// cadastra; todos do laboratório veem o saldo.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupply, listSupplies, updateSupply, type LabExamRef, type LabSupply } from "../../lib/api";
import {
  EMPTY_SUPPLY, INV_SUPPLIES_KEY, SUPPLY_KIND_LABEL, inventoryError, refreshInventory, supplyBody, supplyDraft, supplyKindLabel, supplyProblem,
  type SupplyDraft
} from "../../lib/inventory";
import { staleAware } from "../../lib/qc";
import { Panel } from "../../components/Panel";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, legend, okText, row, stack } from "../exams/styles";

export function SuppliesPanel({ providerId, admin, exams, onGoToSecurity }: { providerId: string; admin: boolean; exams: LabExamRef[]; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const supplies = useQuery({ queryKey: [ INV_SUPPLIES_KEY, providerId ], queryFn: () => listSupplies(providerId), retry: false });
  const [ editing, setEditing ] = useState<LabSupply | "new" | null>(null);
  const [ draft, setDraft ] = useState<SupplyDraft>(EMPTY_SUPPLY);
  const [ confirming, setConfirming ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const set = (patch: Partial<SupplyDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const examName = (id: string) => exams.find((e) => e.id === id)?.name ?? id;

  function open(target: LabSupply | "new") {
    setEditing(target);
    setDraft(target === "new" ? EMPTY_SUPPLY : supplyDraft(target));
    setConfirming(false); setError(null); setNotice(null);
  }

  function review() {
    const problem = supplyProblem(draft);
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  // 404/409: a frase diz que a tela foi atualizada, então relê de fato.
  const failed = staleAware([ "not_found", "conflict" ], () => { void refreshInventory(queryClient).catch(() => undefined); }, inventoryError);

  const cols: Column<LabSupply>[] = [
    { label: "Item", w: "1.6fr", card: "title", render: (s) => s.name },
    { label: "Tipo", w: "0.8fr", render: (s) => supplyKindLabel(s.kind) },
    { label: "Saldo", w: "1fr", render: (s) => <>{`${s.balance} ${s.unit}`}{s.below_minimum && <> <Tag tone="warn">abaixo do mínimo</Tag></>}</> },
    { label: "Mínimo", w: "0.6fr", align: "right", render: (s) => String(s.minimum_stock) },
    { label: "Rendimento", w: "0.8fr", render: (s) => (s.tests_per_package ? `${s.tests_per_package} testes` : "—") },
    { label: "Exames", w: "1.4fr", render: (s) => s.lab_exam_ids.map(examName).join(", ") || "—" }
  ];
  if (admin) cols.push({ label: "", w: "auto", card: "actions", render: (s) => <button type="button" style={secondaryButtonStyle} onClick={() => open(s)}>Editar</button> });

  return (
    <Panel title="Itens de estoque" sub="reagentes, calibradores, controles e consumíveis do laboratório"
      right={admin ? <button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Novo item</button> : undefined}>
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {supplies.isError ? <p role="alert" style={alert}>{inventoryError(supplies.error)}</p> : (
          <DataTable<LabSupply> cols={cols} rows={supplies.data ?? []} rowKey={(s) => s.id} empty={supplies.isPending ? "carregando…" : "nenhum item cadastrado"} />
        )}
        {admin && editing && (
          <fieldset role="group" aria-label={editing === "new" ? "Novo item" : `Editar ${editing.name}`} style={fieldset} disabled={confirming}>
            <legend style={legend}>{editing === "new" ? "Novo item" : `Editar ${editing.name}`}</legend>
            <div style={row}>
              <label style={fieldLabel}>Nome<input value={draft.name} style={inputStyle} onChange={(e) => set({ name: e.target.value })} /></label>
              <label style={fieldLabel}>Tipo
                <select value={draft.kind} style={inputStyle} onChange={(e) => set({ kind: e.target.value as SupplyDraft["kind"], testsPerPackage: "" })}>
                  <option value="">—</option>
                  {Object.entries(SUPPLY_KIND_LABEL).map(([ k, v ]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>Unidade<input value={draft.unit} placeholder="kit, frasco, caixa" style={inputStyle} onChange={(e) => set({ unit: e.target.value })} /></label>
              {draft.kind === "reagent" && (
                <label style={fieldLabel}>Testes por embalagem<input value={draft.testsPerPackage} inputMode="numeric" style={inputStyle} onChange={(e) => set({ testsPerPackage: e.target.value })} /></label>
              )}
              <label style={fieldLabel}>Estoque mínimo<input value={draft.minimumStock} inputMode="numeric" style={inputStyle} onChange={(e) => set({ minimumStock: e.target.value })} /></label>
              <label style={fieldLabel}>Aviso de vencimento (dias)<input value={draft.expiryAlertDays} inputMode="numeric" style={inputStyle} onChange={(e) => set({ expiryAlertDays: e.target.value })} /></label>
            </div>
            <div style={row}>
              {exams.filter((e) => e.id).map((e) => (
                <label key={e.id} style={checkLabel}>
                  <input type="checkbox" checked={draft.examIds.includes(e.id as string)}
                    onChange={(ev) => set({ examIds: ev.target.checked ? [ ...draft.examIds, e.id as string ] : draft.examIds.filter((x) => x !== e.id) })} />{e.name}
                </label>
              ))}
            </div>
            <label style={checkLabel}><input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />Ativo</label>
            {error && <p role="alert" style={alert}>{error}</p>}
            {!confirming && (
              <div style={row}>
                <button type="button" style={buttonStyle} onClick={review}>Revisar e salvar item</button>
                <button type="button" style={secondaryButtonStyle} onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            )}
          </fieldset>
        )}
        {admin && editing && confirming && (
          <SensitiveAction title="Salvar item" description="O item fica disponível para entrada de lote, lote em uso e alertas do estoque."
            requiresStepUp confirmLabel="Salvar item"
            run={async () => {
              const body = supplyBody(draft, providerId);
              if (editing === "new") await createSupply(body); else await updateSupply(editing.id, body);
            }}
            onDone={() => { setConfirming(false); setEditing(null); setNotice("Item salvo."); void refreshInventory(queryClient).catch(() => undefined); }}
            onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={failed} />
        )}
      </div>
    </Panel>
  );
}
