// src/modules/pharmacy/LocationsPanel.tsx
// Locais de estoque (módulo 27a; F-27.1; contrato §3): a tabela, o formulário de novo local e a edição. O tipo escolhe a forma:
// "Almoxarifado central" não tem unidade (só um por cidade); "Farmácia da unidade" tem a unidade de saúde (ativa, uma por local).
// O tipo (e a unidade) não mudam depois de criado. Tudo é conferido aqui antes da confirmação (recusar, nunca cortar) e de novo
// no api; a escrita passa pelo step-up e a tabela é relida depois (PH_ADMIN_KEY). Durante a confirmação o formulário fica à vista,
// parado: a recusa do api (central_exists, unit_taken, location_has_stock…) aparece junto dele.
import { useState } from "react";
import { createAdminLocation, updateAdminLocation } from "../../lib/api";
import type { AdminLocation, AdminLocationInput, HealthUnitRow, StockLocationKind } from "../../lib/api";
import { locationKindLabel, pharmacyError } from "../../lib/pharmacy";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, form, row, stack } from "../exams/styles";
import { fieldBox, fieldsetStyle, hintStyle, statusStyle } from "../regulation/styles";

const KINDS: StockLocationKind[] = [ "central", "unit" ];
const KIND_NOTE = "O tipo não muda depois de criado.";
const EDIT_NOTE = "O tipo e a unidade não mudam depois de criado.";
const NAME_TEXT = "o nome do local tem de 3 a 120 caracteres";
const UNIT_TEXT = "escolha a unidade de saúde da farmácia";

export function staffCount(n: number): string {
  return n === 0 ? "ninguém" : n === 1 ? "1 pessoa" : `${n} pessoas`;
}

type Editor = AdminLocation | "new" | null;

export function LocationsPanel({ locations, units, selectedId, onSelectStaff, onSaved, onGoToSecurity }: {
  locations: AdminLocation[]; units: HealthUnitRow[]; selectedId: string | null;
  onSelectStaff(id: string): void; onSaved(): void; onGoToSecurity?(): void;
}) {
  const [ editor, setEditor ] = useState<Editor>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const open = (next: Editor) => { setNotice(null); setEditor(next); };

  return (
    <div style={stack}>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      <Panel title="Locais de estoque" sub="almoxarifado central e farmácias das unidades"
        right={<button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Novo local</button>}>
        <DataTable<AdminLocation>
          cols={[
            { label: "Local", w: "1.8fr", card: "title", render: (l) => l.name },
            { label: "Tipo", w: "1.3fr", render: (l) => locationKindLabel(l.kind) },
            { label: "Unidade", w: "1.4fr", render: (l) => l.health_unit?.name ?? "—" },
            { label: "Situação", w: "90px", render: (l) => <Tag tone={l.active ? "ok" : "neutral"}>{l.active ? "ativo" : "inativo"}</Tag> },
            {
              label: "Equipe", w: "1fr", render: (l) => (
                <button type="button" style={selectedId === l.id ? buttonStyle : secondaryButtonStyle}
                  aria-label={`Equipe de ${l.name}`} aria-pressed={selectedId === l.id} onClick={() => onSelectStaff(l.id)}>
                  {staffCount(l.staff.length)}
                </button>
              )
            },
            {
              label: "Ação", w: "90px", card: "actions" as const,
              render: (l) => <button type="button" style={secondaryButtonStyle} onClick={() => open(l)}>Editar</button>
            }
          ]}
          rows={locations} rowKey={(l) => l.id} empty="nenhum local de estoque cadastrado"
        />
      </Panel>
      {editor && (
        <LocationForm key={editor === "new" ? "new" : editor.id} location={editor === "new" ? null : editor} units={units}
          onSaved={(message) => { setEditor(null); setNotice(message); onSaved(); }} onCancel={() => setEditor(null)} onGoToSecurity={onGoToSecurity} />
      )}
    </div>
  );
}

function LocationForm({ location, units, onSaved, onCancel, onGoToSecurity }: {
  location: AdminLocation | null; units: HealthUnitRow[]; onSaved(message: string): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const [ kind, setKind ] = useState<string>(location?.kind ?? "");
  const [ name, setName ] = useState(location?.name ?? "");
  const [ unitId, setUnitId ] = useState(location?.health_unit?.id ?? "");
  const [ active, setActive ] = useState(location?.active ?? true);
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { setError(null); set(v); };

  const isUnit = kind === "unit";
  // A unidade atual do local aparece mesmo desativada (a edição não a perde); as demais, só as ativas.
  const options = units.filter((u) => u.active || u.id === location?.health_unit?.id);

  function body(): AdminLocationInput {
    const base = { kind: kind as StockLocationKind, name: name.trim(), active };
    return isUnit ? { kind: base.kind, health_unit_id: unitId, name: base.name, active } : base;
  }

  function review() {
    const length = name.trim().length;
    const problem = (kind === "" ? "escolha o tipo do local" : null)
      ?? (length < 3 || length > 120 ? NAME_TEXT : null)
      ?? (isUnit && unitId === "" ? UNIT_TEXT : null);
    if (problem) { setError(problem); return; }
    setConfirming(true);
  }

  const label = name.trim();
  return (
    <section aria-label={location ? "Editar local" : "Novo local"} style={box}>
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={form}>
          <div style={fieldBox}>
            <label style={fieldLabel}>
              Tipo
              <select value={kind} disabled={location !== null || confirming} style={inputStyle} onChange={(e) => touch(setKind)(e.target.value)}>
                <option value="">escolha</option>
                {KINDS.map((k) => <option key={k} value={k}>{locationKindLabel(k)}</option>)}
              </select>
            </label>
            <span style={hintStyle}>{location ? EDIT_NOTE : KIND_NOTE}</span>
          </div>
          <div style={fieldBox}>
            <label style={fieldLabel}>
              Nome
              <input value={name} style={inputStyle} onChange={(e) => touch(setName)(e.target.value)} />
            </label>
            <span style={hintStyle}>de 3 a 120 caracteres</span>
          </div>
          {isUnit && (
            <div style={fieldBox}>
              <label style={fieldLabel}>
                Unidade de saúde
                <select value={unitId} disabled={location !== null || confirming} style={inputStyle} onChange={(e) => touch(setUnitId)(e.target.value)}>
                  <option value="">escolha</option>
                  {options.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <span style={hintStyle}>Uma unidade tem uma só farmácia; a unidade passa a dispensar.</span>
            </div>
          )}
          <label style={checkLabel}>
            <input type="checkbox" checked={active} onChange={(e) => touch(setActive)(e.target.checked)} />
            Ativo
          </label>
          {error && <p role="alert" style={alert}>{error}</p>}
          {!confirming && (
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={review}>Revisar</button>
              <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
            </div>
          )}
        </div>
      </fieldset>
      {confirming && (
        <SensitiveAction
          title={location ? `Salvar ${label}` : `Criar o local ${label}`}
          description={active
            ? "Locais ativos recebem estoque, transferências e dispensação. Só se desativa um local sem saldo."
            : "Local inativo não recebe nem dispensa; o histórico de movimentos fica."}
          requiresStepUp
          confirmLabel={location ? "Salvar local" : "Criar local"}
          run={async () => { if (location) await updateAdminLocation(location.id, body()); else await createAdminLocation(body()); }}
          onDone={() => onSaved(`Local ${label} salvo.`)}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => pharmacyError(err)}
        />
      )}
    </section>
  );
}
