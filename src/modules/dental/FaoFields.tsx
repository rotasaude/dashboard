// Campos da ficha odontológica do e-SUS (FAO). Os rótulos vêm do vocabulário das opções (O4); a lógica, de `lib/dental`.
import { useEffect, useState } from "react";
import type { DentalFields, DentalRole, DentalVocabulary, Sex } from "../../lib/api";
import { isReferralOutcome, toggleSurveillance } from "../../lib/dental";
import { inputStyle } from "../../components/formStyles";
import { checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";

interface Props {
  value: DentalFields;
  sex: Sex;
  role: DentalRole;
  prefilledPregnant: boolean;
  vocabulary?: DentalVocabulary;
  onChange(f: DentalFields): void;
}

const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [ ...list, code ]);

export function FaoFields({ value, sex, role, prefilledPregnant, vocabulary, onChange }: Props) {
  const [ confirmed, setConfirmed ] = useState(false);
  const male = sex === "male";

  // Masculino: o campo não existe e vai em branco (nulo), mesmo que o rascunho tenha vindo marcado.
  useEffect(() => {
    if (male && value.pregnant !== null) onChange({ ...value, pregnant: null });
  }, [ male, value, onChange ]);

  const outcomes = (vocabulary?.outcomes ?? []).filter((o) => role !== "auxiliary" || !(isReferralOutcome(o.code) || o.code === "15"));
  const consultTypeOff = value.care_type === "4";

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Ficha odontológica (e-SUS)</legend>
      <label style={fieldLabel}>
        Tipo de atendimento
        <select value={value.care_type ?? ""} style={inputStyle}
          onChange={(e) => {
            const care = e.target.value || null;
            onChange({ ...value, care_type: care, dental_consultation_type: care === "4" ? null : value.dental_consultation_type });
          }}>
          <option value="">—</option>
          {(vocabulary?.care_types ?? []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </label>
      <label style={fieldLabel}>
        Tipo de consulta odontológica
        <select value={value.dental_consultation_type ?? ""} disabled={consultTypeOff} style={inputStyle}
          onChange={(e) => onChange({ ...value, dental_consultation_type: e.target.value || null })}>
          <option value="">—</option>
          {(vocabulary?.consultation_types ?? []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </label>
      <fieldset style={fieldset}>
        <legend style={legend}>Vigilância em saúde bucal</legend>
        {(vocabulary?.surveillance ?? []).map((o) => (
          <label key={o.code} style={checkLabel}>
            <input type="checkbox" checked={value.oral_health_surveillance.includes(o.code)}
              onChange={() => onChange({ ...value, oral_health_surveillance: toggleSurveillance(value.oral_health_surveillance, o.code) })} />
            {o.label}
          </label>
        ))}
      </fieldset>
      <fieldset style={fieldset}>
        <legend style={legend}>Fornecimento</legend>
        {(vocabulary?.supplies ?? []).map((o) => (
          <label key={o.code} style={checkLabel}>
            <input type="checkbox" checked={value.supplies.includes(o.code)} onChange={() => onChange({ ...value, supplies: toggle(value.supplies, o.code) })} />
            {o.label}
          </label>
        ))}
      </fieldset>
      <fieldset style={fieldset}>
        <legend style={legend}>Desfecho</legend>
        {outcomes.map((o) => (
          <label key={o.code} style={checkLabel}>
            <input type="checkbox" checked={value.dental_outcomes.includes(o.code)}
              onChange={() => onChange({ ...value, dental_outcomes: toggle(value.dental_outcomes, o.code) })} />
            {o.label}
          </label>
        ))}
      </fieldset>
      {male ? (
        <p style={muted}>Gestante não se aplica: vai em branco na ficha.</p>
      ) : (
        <fieldset style={fieldset}>
          <legend style={legend}>Gestante</legend>
          <span style={row}>
            {([ [ true, "Sim" ], [ false, "Não" ] ] as const).map(([ v, text ]) => (
              <label key={text} style={checkLabel}>
                <input type="radio" name="dental-pregnant" checked={value.pregnant === v}
                  onClick={() => setConfirmed(true)}
                  onChange={() => { setConfirmed(true); onChange({ ...value, pregnant: v }); }} />
                {text}
              </label>
            ))}
          </span>
          {prefilledPregnant && value.pregnant === true && !confirmed && <p style={muted}>pré-preenchido pela linha de pré-natal — confirme</p>}
        </fieldset>
      )}
      <label style={checkLabel}>
        <input type="checkbox" checked={value.special_needs} onChange={(e) => onChange({ ...value, special_needs: e.target.checked })} />
        Paciente com necessidades especiais
      </label>
    </fieldset>
  );
}
