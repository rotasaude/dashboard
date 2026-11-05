import { useRef, useState } from "react";
import type { Neighborhood, ScreeningScope } from "../../lib/api";
import { SCOPE_LABEL } from "../../lib/screening";
import { onlyDigits, unitKindOptions } from "../../lib/attendance";
import { CAPS_MODALITIES, modalityLabel, phoneProblem, unitCapsProblems } from "../../lib/psychosocial";
import { matchNeighborhood, sortByName } from "../../lib/territory";
import { maskCep, zipError, type AddressFields } from "../../lib/unitAddress";
import { VIACEP_TIMEOUT_MS, lookupCep } from "../../lib/viacep";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

// Formulário da unidade (módulo 09 + endereço do módulo 11; spec 2026-09-28
// §5, D6). Com 8 dígitos de CEP, o navegador consulta o ViaCEP. O logradouro
// vem preenchido, e o bairro do CEP é só sugestão. Ele pré-seleciona um
// bairro ATIVO de mesmo nome apenas se o admin ainda não escolheu nenhum.
// Qualquer falha deixa os campos livres.
// `notifying` (módulo 25) só aparece com o interruptor `surveillance` ligado e na edição.
// `screeningScope` (módulo 18) só existe na edição: a unidade nova nasce `walk_in` no api.
// `cnes` (T47, módulo 30): opcional em todo tipo; vazio = sem CNES. A unidade Gestão precisa dele para o BPA do TFD.
// Módulo 31: `phone` (P27) vale para toda unidade (10 ou 11 dígitos; vazio = sem telefone); `capsModality` e `serviceClassification`
// (115, opcional, 3 dígitos) só existem com `kind === "caps"`.
export interface UnitFormValue extends AddressFields {
  name: string; kind: string; cnes?: string; screeningScope?: ScreeningScope; collectsSamples?: boolean; notifying?: boolean;
  phone?: string; capsModality?: string; serviceClassification?: string;
}
export const CNES_TEXT = "o CNES tem 7 dígitos";

interface Props {
  initial: UnitFormValue;
  neighborhoods: Neighborhood[];
  busy: boolean;
  cepTimeoutMs?: number;
  // Módulo 28: `dental_care` ligado (canUseDental, vindo do Atendimento) — só então o CEO é oferecido.
  dentalOn?: boolean;
  // Módulo 30: transporte usável (canUseTransport) — só então a unidade de gestão é oferecida.
  tfdOn?: boolean;
  // Módulo 31: `psychosocial_care` + `clinical_record` (canUsePsychosocial) — só então o CAPS é oferecido.
  capsOn?: boolean;
  onSave(value: UnitFormValue): void;
  onCancel(): void;
}

type CepState = { kind: "idle" } | { kind: "loading" } | { kind: "found"; neighborhood: string } | { kind: "failed" };

export function UnitForm({ initial, neighborhoods, busy, cepTimeoutMs = VIACEP_TIMEOUT_MS, dentalOn = false, tfdOn = false, capsOn = false, onSave, onCancel }: Props) {
  const [ value, setValue ] = useState<UnitFormValue>(initial);
  const [ cep, setCep ] = useState<CepState>({ kind: "idle" });
  // Todas as recusas de uma vez: cada texto é um alerta.
  const [ errors, setErrors ] = useState<string[]>([]);
  const [ cnesError, setCnesError ] = useState(false);
  const [ phoneError, setPhoneError ] = useState(false);
  const [ capsPaths, setCapsPaths ] = useState<string[]>([]);
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
    const found: string[] = [];
    const cnes = value.cnes ?? "";
    const badCnes = cnes !== "" && !/^\d{7}$/.test(cnes);
    if (badCnes) found.push(CNES_TEXT);
    const invalidZip = zipError(value.zip);
    if (invalidZip) found.push(invalidZip);
    const phone = phoneProblem(value.phone ?? "");
    if (phone) found.push(phone);
    const caps = unitCapsProblems({ kind: value.kind, capsModality: value.capsModality ?? "", serviceClassification: value.serviceClassification ?? "" });
    found.push(...caps.map((p) => p.text));
    setCnesError(badCnes);
    setPhoneError(!!phone);
    setCapsPaths(caps.map((p) => p.path));
    setErrors(found);
    if (found.length > 0) return;
    // Fora do CAPS, a modalidade e a classificação não seguem (o api recusaria `caps_modality_mismatch`).
    onSave(value.kind === "caps" ? value : { ...value, capsModality: undefined, serviceClassification: undefined });
  }

  const blocked = busy || !value.name.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
      {errors.map((text) => <p key={text} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{text}</p>)}
      <label style={labelStyle}>
        Nome
        <input value={value.name} onChange={(e) => set({ name: e.target.value })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Tipo
        <select value={value.kind} onChange={(e) => set({ kind: e.target.value })} style={inputStyle}>
          {unitKindOptions(dentalOn || value.kind === "ceo", tfdOn || value.kind === "health_management", capsOn || value.kind === "caps").map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      {value.kind === "caps" && (
        <>
          <label style={labelStyle}>
            Modalidade do CAPS
            <select value={value.capsModality ?? ""} onChange={(e) => set({ capsModality: e.target.value })} style={inputStyle}
              aria-invalid={capsPaths.includes("caps_modality") ? true : undefined}>
              <option value="">Escolha a modalidade</option>
              {CAPS_MODALITIES.map((m) => <option key={m} value={m}>{modalityLabel(m)}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Classificação do serviço 115
            <input value={value.serviceClassification ?? ""} onChange={(e) => set({ serviceClassification: onlyDigits(e.target.value).slice(0, 3) })} style={inputStyle}
              inputMode="numeric" maxLength={3} placeholder="3 dígitos, como no CNES (opcional)"
              aria-invalid={capsPaths.includes("service_classification") ? true : undefined} />
          </label>
        </>
      )}
      <label style={labelStyle}>
        CNES (opcional)
        <input value={value.cnes ?? ""} onChange={(e) => { set({ cnes: onlyDigits(e.target.value).slice(0, 7) }); setCnesError(false); }} style={inputStyle}
          inputMode="numeric" placeholder="7 dígitos" aria-invalid={cnesError ? true : undefined} />
      </label>
      <label style={labelStyle}>
        Telefone
        <input value={value.phone ?? ""} onChange={(e) => set({ phone: onlyDigits(e.target.value) })} style={inputStyle}
          inputMode="tel" placeholder="10 ou 11 dígitos, com DDD (opcional)" aria-invalid={phoneError ? true : undefined} />
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
      {value.collectsSamples !== undefined && (
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={value.collectsSamples} onChange={(e) => set({ collectsSamples: e.target.checked })} />
          Coleta amostras para o laboratório municipal
        </label>
      )}
      {value.notifying !== undefined && (
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={value.notifying} onChange={(e) => set({ notifying: e.target.checked })} />
          Unidade notificadora (notificação negativa semanal)
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
