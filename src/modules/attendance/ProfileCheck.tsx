// Perfil conferido no documento na validação presencial (módulo 15; spec
// §5.4; contratos §4.4). Mostra o que o cidadão declarou e pede data de
// nascimento e sexo como estão no documento; a identidade de gênero é
// opcional e nunca entra na elegibilidade.
import type { CSSProperties } from "react";
import type { CitizenProfile, GenderIdentity, Sex } from "../../lib/api";
import { GENDER_IDENTITY_OPTIONS, NO_GENDER_IDENTITY, SEX_OPTIONS, birthDateProblem, describeProfile } from "../../lib/profile";
import { inputStyle } from "../../components/formStyles";

export interface ProfileCheckValue { birthDate: string; sex: Sex | ""; genderIdentity: GenderIdentity | "" }

export function initialProfileCheck(declared: CitizenProfile | null): ProfileCheckValue {
  return { birthDate: declared?.birth_date ?? "", sex: declared?.sex ?? "", genderIdentity: declared?.gender_identity ?? "" };
}

export function profileCheckProblem(value: ProfileCheckValue, today: string): string | null {
  return birthDateProblem(value.birthDate, today) ?? (value.sex === "" ? "informe o sexo do documento" : null);
}

export function ProfileCheck({ declared, value, today, onChange }: {
  declared: CitizenProfile | null; value: ProfileCheckValue; today: string; onChange(next: ProfileCheckValue): void;
}) {
  const problem = profileCheckProblem(value, today);
  return (
    <fieldset aria-label="Perfil conferido no documento" style={box}>
      <legend style={{ fontSize: 13, fontWeight: 600 }}>Perfil conferido no documento</legend>
      <p style={hint}>
        Declarado pelo cidadão: {describeProfile(declared, today)}
        {declared?.profile_source === "verified" ? " · já conferido no posto" : ""}
      </p>
      <label style={label}>
        Data de nascimento (documento)
        <input type="date" value={value.birthDate} max={today} style={inputStyle}
          onChange={(e) => onChange({ ...value, birthDate: e.target.value })} />
      </label>
      <label style={label}>
        Sexo (documento)
        <select value={value.sex} style={inputStyle} onChange={(e) => onChange({ ...value, sex: e.target.value as Sex | "" })}>
          <option value="">escolha…</option>
          {SEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label style={label}>
        Identidade de gênero (opcional)
        <select value={value.genderIdentity} style={inputStyle}
          onChange={(e) => onChange({ ...value, genderIdentity: e.target.value as GenderIdentity | "" })}>
          <option value="">{NO_GENDER_IDENTITY}</option>
          {GENDER_IDENTITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {problem && <small style={hint}>{problem}</small>}
    </fieldset>
  );
}

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, maxWidth: 360, border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
