// Nomes do documento no balcão (módulo 19). Sem FrozenTextNotice: o aviso
// padrão pede para não escrever nomes, e aqui o nome é o dado conferido.
import type { CSSProperties } from "react";
import type { NamesDraft } from "../../lib/citizenNames";
import { inputStyle } from "../../components/formStyles";

interface Props { value: NamesDraft; onChange(next: NamesDraft): void; problem: string | null }

export function NamesFields({ value, onChange, problem }: Props) {
  const set = (patch: Partial<NamesDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset style={fieldset}>
      <legend style={{ fontSize: 12.5, fontWeight: 600 }}>Nomes (como no documento)</legend>
      <label style={labelStyle}>
        Nome completo (documento)
        <input value={value.fullName} autoComplete="off" style={inputStyle} onChange={(e) => set({ fullName: e.target.value })} />
      </label>
      <label style={labelStyle}>
        Nome social (opcional)
        <input value={value.socialName} autoComplete="off" style={inputStyle} onChange={(e) => set({ socialName: e.target.value })} />
      </label>
      <label style={labelStyle}>
        Nome da mãe (opcional)
        <input value={value.motherName} autoComplete="off" style={inputStyle} onChange={(e) => set({ motherName: e.target.value })} />
      </label>
      {problem && <small role="alert" style={{ fontSize: 12, color: "var(--down)" }}>{problem}</small>}
    </fieldset>
  );
}

const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--rule)", borderRadius: 8, padding: 12, maxWidth: 420 };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
