// REMUME (módulo 19c; spec §3; contrato §6): os medicamentos do catálogo da
// plataforma que a rede municipal tem, com as unidades opcionais (nenhuma =
// todas). Na busca da receita eles vêm primeiro, com "na rede". Incluir, trocar
// as unidades (o POST de um item que já existe atualiza e devolve 200) e tirar
// passam pelo step-up. A busca no catálogo é a mesma da receita (Divergência
// D5: o api a libera ao municipal_admin); o controlado aparece liberado, porque
// a cidade pode dispensá-lo.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addRemumeItem, errorCode, listActiveUnits, listRemume, removeRemumeItem, type MedicationSearchItem, type RemumeEntry } from "../../lib/api";
import { REMUME_KEY, documentError } from "../../lib/clinicalDocuments";
import { Panel } from "../../components/Panel";
import { DataTable, type Column } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { MedicationSearch } from "../documents/MedicationSearch";

type Confirming =
  | { kind: "add"; item: MedicationSearchItem; unitIds: string[]; swap: boolean }
  | { kind: "remove"; entry: RemumeEntry };

export function RemumePanel({ onGoToSecurity, searchDelayMs }: { onGoToSecurity?(): void; searchDelayMs?: number }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ REMUME_KEY ], queryFn: listRemume, retry: false });
  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits });
  const [ picked, setPicked ] = useState<MedicationSearchItem | null>(null);
  const [ unitIds, setUnitIds ] = useState<string[]>([]);
  const [ confirming, setConfirming ] = useState<Confirming | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const reload = () => void queryClient.invalidateQueries({ queryKey: [ REMUME_KEY ] });
  const unitName = (id: string) => units.data?.find((u) => u.id === id)?.name ?? id;
  const existing = picked ? (query.data ?? []).find((e) => e.catalog_item.id === picked.id) : undefined;
  const swap = existing !== undefined;

  const cols: Column<RemumeEntry>[] = [
    { label: "Medicamento", w: "2.4fr", render: (e) => e.catalog_item.label },
    { label: "CATMAT", w: "0.8fr", render: (e) => <span className="mono">{e.catalog_item.catmat_code}</span> },
    { label: "Unidades", w: "1.6fr", render: (e) => (e.unit_ids.length === 0 ? "todas" : e.unit_ids.map(unitName).join(", ")) },
    { label: "", w: "auto", align: "right", render: (e) => (
      <button type="button" aria-label={`Tirar ${e.catalog_item.label} da REMUME`} disabled={confirming !== null}
        style={confirming !== null ? disabledButtonStyle : secondaryButtonStyle}
        onClick={() => { setNotice(null); setConfirming({ kind: "remove", entry: e }); }}>Tirar</button>
    ) }
  ];

  function pick(item: MedicationSearchItem) {
    setNotice(null);
    setPicked(item);
    setUnitIds((query.data ?? []).find((e) => e.catalog_item.id === item.id)?.unit_ids ?? []);
  }

  function toggleUnit(id: string, on: boolean) {
    setUnitIds((prev) => (on ? [ ...prev, id ] : prev.filter((u) => u !== id)));
  }

  return (
    <Panel title="REMUME" sub="relação municipal de medicamentos · aparecem primeiro na receita, como “na rede”">
      <div style={body}>
        {notice && <p role="status" style={statusStyle}>{notice}</p>}
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{documentError(query.error)}</p>}
        {query.isSuccess && <DataTable cols={cols} rows={query.data} rowKey={(e) => e.catalog_item.id} empty="nenhum medicamento na REMUME" />}

        {/* Só com a REMUME lida: sem ela não se sabe se o item já está lá, e o POST regravaria as unidades como "todas". */}
        {query.isSuccess && !picked && !confirming && (
          <MedicationSearch label="Incluir na REMUME" blockControlled={false} delayMs={searchDelayMs} onPick={pick} />
        )}
        {picked && !confirming && (
          <section aria-label={`Incluir: ${picked.label}`} style={box}>
            <strong>{picked.label}</strong>
            {swap && <p style={muted}>este medicamento já está na REMUME — você pode trocar as unidades</p>}
            <p style={muted}>Unidades (nenhuma marcada = todas as unidades da rede)</p>
            <div style={row}>
              {(units.data ?? []).map((u) => (
                <label key={u.id} style={checkLabel}>
                  <input type="checkbox" checked={unitIds.includes(u.id)} onChange={(e) => toggleUnit(u.id, e.target.checked)} />
                  {u.name}
                </label>
              ))}
            </div>
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={() => setConfirming({ kind: "add", item: picked, unitIds, swap })}>
                {swap ? "Trocar unidades" : "Incluir"}
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={() => setPicked(null)}>Cancelar</button>
            </div>
          </section>
        )}

        {confirming?.kind === "add" && (
          <SensitiveAction
            title={`${confirming.swap ? "Trocar unidades na" : "Incluir na"} REMUME: ${confirming.item.label}`}
            description={confirming.unitIds.length === 0 ? "Em todas as unidades da rede." : `Unidades: ${confirming.unitIds.map(unitName).join(", ")}.`}
            requiresStepUp
            confirmLabel={confirming.swap ? "Confirmar troca" : "Confirmar inclusão"}
            run={async () => { await addRemumeItem(confirming.item.id, confirming.unitIds); }}
            onDone={() => {
              setNotice(confirming.swap ? "Unidades da REMUME atualizadas." : "Medicamento incluído na REMUME.");
              setConfirming(null); setPicked(null); reload();
            }}
            onCancel={() => setConfirming(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (errorCode(err) ? documentError(err) : null)}
          />
        )}
        {confirming?.kind === "remove" && (
          <SensitiveAction
            title={`Tirar da REMUME: ${confirming.entry.catalog_item.label}`}
            description={'Ele deixa de aparecer como "na rede" na busca da receita; receitas já emitidas não mudam.'}
            requiresStepUp
            confirmLabel="Confirmar retirada"
            run={async () => { await removeRemumeItem(confirming.entry.catalog_item.id); }}
            onDone={() => { setConfirming(null); setNotice("Medicamento retirado da REMUME."); reload(); }}
            onCancel={() => setConfirming(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (errorCode(err) ? documentError(err) : null)}
          />
        )}
      </div>
    </Panel>
  );
}

const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 12.5 };
const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const row: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };
const checkLabel: CSSProperties = { display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--ink2)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
