// src/modules/regulation/ProviderForm.tsx
// Novo prestador ou edição (módulo 26a; F-26.4; contrato §6, G5, G7). Nome de 3 a 120 caracteres; fora da rede própria o CNES
// tem 7 dígitos; na rede própria o CNES não é digitado: o api o herda da unidade da rede (ativa), e o tipo nunca muda depois de
// criado. Tudo é conferido aqui antes da confirmação (recusar, nunca cortar) e de novo no api; a escrita passa pelo step-up.
// Durante a confirmação o formulário fica à vista, parado: a recusa do api (cnes_taken, unit_taken…) aparece junto dele.
import { useState } from "react";
import { createCareProvider, updateCareProvider } from "../../lib/api";
import type { CareProvider, CareProviderInput, HealthUnitRow, ProviderKind } from "../../lib/api";
import { cnesProblem, providerKindLabel, providerNameProblem, regulationError } from "../../lib/regulation";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, form, row } from "../exams/styles";
import { fieldBox, fieldsetStyle, hintStyle } from "./styles";

const KINDS: ProviderKind[] = [ "own", "contracted", "consortium", "ppi" ];
const OWN_NOTE = "O CNES do prestador da rede própria é o da unidade escolhida.";
const KIND_NOTE = "O tipo não muda depois de criado.";

export function ProviderForm({ provider, units, onSaved, onCancel, onGoToSecurity }: {
  provider: CareProvider | null; units: HealthUnitRow[]; onSaved(message: string): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const [ name, setName ] = useState(provider?.name ?? "");
  const [ kind, setKind ] = useState<string>(provider?.kind ?? "");
  const [ cnes, setCnes ] = useState(provider && provider.kind !== "own" ? provider.cnes : "");
  const [ unitId, setUnitId ] = useState(provider?.health_unit?.id ?? "");
  const [ active, setActive ] = useState(provider?.active ?? true);
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { setError(null); set(v); };

  const own = kind === "own";
  // A unidade atual do prestador aparece mesmo desativada (a edição não a perde); as demais, só as ativas.
  const options = units.filter((u) => u.active || u.id === provider?.health_unit?.id);

  function body(): CareProviderInput {
    const base = { name: name.trim(), kind: kind as ProviderKind, active };
    return own ? { ...base, health_unit_id: unitId } : { ...base, cnes: cnes.trim() };
  }

  function review() {
    const problem = providerNameProblem(name)
      ?? (kind === "" ? "escolha o tipo do prestador" : null)
      ?? (own ? (unitId === "" ? "escolha a unidade da rede" : null) : cnesProblem(cnes));
    if (problem) { setError(problem); return; }
    setConfirming(true);
  }

  const label = name.trim();
  return (
    <section aria-label={provider ? "Editar prestador" : "Novo prestador"} style={box}>
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={form}>
          <div style={fieldBox}>
            <label style={fieldLabel}>
              Nome
              <input value={name} style={inputStyle} onChange={(e) => touch(setName)(e.target.value)} />
            </label>
            <span style={hintStyle}>de 3 a 120 caracteres</span>
          </div>
          <div style={fieldBox}>
            <label style={fieldLabel}>
              Tipo
              <select value={kind} disabled={provider !== null || confirming} style={inputStyle} onChange={(e) => touch(setKind)(e.target.value)}>
                <option value="">escolha</option>
                {KINDS.map((k) => <option key={k} value={k}>{providerKindLabel(k)}</option>)}
              </select>
            </label>
            <span style={hintStyle}>{KIND_NOTE}</span>
          </div>
          {kind !== "" && !own && (
            <div style={fieldBox}>
              <label style={fieldLabel}>
                CNES
                <input value={cnes} inputMode="numeric" style={inputStyle} onChange={(e) => touch(setCnes)(e.target.value)} />
              </label>
              <span style={hintStyle}>7 dígitos</span>
            </div>
          )}
          {own && (
            <div style={fieldBox}>
              <label style={fieldLabel}>
                Unidade da rede
                <select value={unitId} style={inputStyle} onChange={(e) => touch(setUnitId)(e.target.value)}>
                  <option value="">escolha</option>
                  {options.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <span style={hintStyle}>{OWN_NOTE}</span>
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
          title={provider ? `Salvar ${label}` : `Criar o prestador ${label}`}
          description={active
            ? "Prestadores ativos recebem ofertas e entram na autorização dos pedidos."
            : "Prestador inativo não recebe ofertas novas; as ofertas e autorizações já feitas ficam."}
          requiresStepUp
          confirmLabel="Confirmar"
          run={async () => { if (provider) await updateCareProvider(provider.id, body()); else await createCareProvider(body()); }}
          onDone={() => onSaved(`Prestador ${label} salvo.`)}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => regulationError(err)}
        />
      )}
    </section>
  );
}
