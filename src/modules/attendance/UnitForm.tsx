import { useRef, useState } from "react";
import type { Neighborhood, ScreeningScope } from "../../lib/api";
import { SCOPE_LABEL } from "../../lib/screening";
import { UNIT_KINDS, onlyDigits } from "../../lib/attendance";
import { matchNeighborhood, sortByName } from "../../lib/territory";
import { maskCep, zipError, type AddressFields } from "../../lib/unitAddress";
import { VIACEP_TIMEOUT_MS, lookupCep } from "../../lib/viacep";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

// Formulário da unidade (módulo 09 + endereço do módulo 11; spec 2026-09-28
// §5, D6). Com 8 dígitos de CEP, o navegador consulta o ViaCEP. O logradouro
// vem preenchido, e o bairro do CEP é só sugestão. Ele pré-seleciona um
// bairro ATIVO de mesmo nome apenas se o admin ainda não escolheu nenhum.
// Qualquer falha deixa os campos livres.
// `screeningScope` (módulo 18) só existe na edição: a unidade nova nasce `walk_in` no api.
export interface UnitFormValue extends AddressFields { name: string; kind: string; screeningScope?: ScreeningScope }

interface Props {
  initial: UnitFormValue;
  neighborhoods: Neighborhood[];
  busy: boolean;
  cepTimeoutMs?: number;
  onSave(value: UnitFormValue): void;
  onCancel(): void;
}

type CepState = { kind: "idle" } | { kind: "loading" } | { kind: "found"; neighborhood: string } | { kind: "failed" };

export function UnitForm({ initial, neighborhoods, busy, cepTimeoutMs = VIACEP_TIMEOUT_MS, onSave, onCancel }: Props) {
  const [ value, setValue ] = useState<UnitFormValue>(initial);
  const [ cep, setCep ] = useState<CepState>({ kind: "idle" });
  const [ error, setError ] = useState<string | null>(null);
  // Cada CEP digitado ganha um número; resposta de número velho é descartada
  // (o admin corrigiu o CEP antes de a primeira consulta voltar).
  const seq = useRef(0);
  // A lista pode chegar depois do clique: a resposta do ViaCEP casa com a mais nova.
  const neighborhoodsRef = useRef(neighborhoods);
  neighborhoodsRef.current = neighborhoods;

  const set = (patch: Partial<UnitFormValue>) => setValue((v) => ({ ...v, ...patch }));

  // Escolha nova só entre ativos; o bairro atual aparece mesmo se inativo,
  // marcado, para a edição não apagá-lo em silêncio.
  const options = sortByName(neighborhoods.filter((n) => n.active || n.id === value.neighborhoodId));

  async function onZip(raw: string) {
    const zip = maskCep(raw);
    set({ zip });
    const request = ++seq.current;
    if (onlyDigits(zip).length !== 8) { setCep({ kind: "idle" }); return; }
    setCep({ kind: "loading" });
    const result = await lookupCep(zip, cepTimeoutMs);
    if (request !== seq.current) return;
    if (!result.ok) { setCep({ kind: "failed" }); return; }
    setCep({ kind: "found", neighborhood: result.neighborhood });
    const match = matchNeighborhood(result.neighborhood, neighborhoodsRef.current);
    setValue((v) => ({
      ...v,
      street: result.street || v.street,
      neighborhoodId: v.neighborhoodId || match?.id || ""
    }));
  }

  function save() {
    if (busy || !value.name.trim()) return;
    const invalidZip = zipError(value.zip);
    if (invalidZip) { setError(invalidZip); return; }
    setError(null);
    onSave(value);
  }

  const blocked = busy || !value.name.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={labelStyle}>
        Nome
        <input value={value.name} onChange={(e) => set({ name: e.target.value })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Tipo
        <select value={value.kind} onChange={(e) => set({ kind: e.target.value })} style={inputStyle}>
          {UNIT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        CEP
        <input value={value.zip} onChange={(e) => void onZip(e.target.value)} style={inputStyle}
          inputMode="numeric" placeholder="00000-000" />
      </label>
      {cep.kind === "loading" && <p role="status" className="mono" style={hintStyle}>consultando o CEP…</p>}
      {cep.kind === "failed" && (
        <p role="status" style={{ ...hintStyle, color: "var(--warn)" }}>não foi possível consultar o CEP — preencha o endereço à mão</p>
      )}
      {cep.kind === "found" && cep.neighborhood && (
        <p role="status" style={hintStyle}>{`bairro segundo o CEP: ${cep.neighborhood}`}</p>
      )}
      <label style={labelStyle}>
        Logradouro
        <input value={value.street} onChange={(e) => set({ street: e.target.value })} style={inputStyle} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ ...labelStyle, width: 110 }}>
          Número
          <input value={value.number} onChange={(e) => set({ number: e.target.value })} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Complemento
          <input value={value.complement} onChange={(e) => set({ complement: e.target.value })} style={inputStyle} />
        </label>
      </div>
      <label style={labelStyle}>
        Bairro
        <select value={value.neighborhoodId} onChange={(e) => set({ neighborhoodId: e.target.value })} style={inputStyle}>
          <option value="">—</option>
          {options.map((n) => <option key={n.id} value={n.id}>{n.active ? n.name : `${n.name} (inativo)`}</option>)}
        </select>
      </label>
      {value.screeningScope !== undefined && (
        <label style={labelStyle}>
          Acolhimento (escuta inicial)
          <select value={value.screeningScope} style={inputStyle}
            onChange={(e) => set({ screeningScope: e.target.value as ScreeningScope })}>
            {(Object.keys(SCOPE_LABEL) as ScreeningScope[]).map((k) => <option key={k} value={k}>{SCOPE_LABEL[k]}</option>)}
          </select>
        </label>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={blocked} onClick={save} style={blocked ? disabledButtonStyle : buttonStyle}>Salvar</button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </div>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
const hintStyle = { margin: 0, fontSize: 11.5, color: "var(--ink3)" };
