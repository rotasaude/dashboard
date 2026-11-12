// Destino da ouvidoria (setor da secretaria ou unidade de saúde) num `<select>` com dois grupos; valor `department:<id>` ou
// `health_unit:<id>`. Com `requireResponder` (encaminhamento, Task 6), destino sem respondente ativo fica indisponível
// (" — sem respondente"); sem ele (respondentes da Configuração, Task 11), todos ficam escolhíveis.
import type { SelectHTMLAttributes } from "react";

export type DestinationKind = "department" | "health_unit";
type Destination = { id: string; name: string; has_active_responder?: boolean };

export const destinationValue = (kind: DestinationKind, id: string): string => `${kind}:${id}`;

export function parseDestination(value: string): { kind: DestinationKind; id: string } | null {
  const m = /^(department|health_unit):(.+)$/.exec(value);
  return m ? { kind: m[1] as DestinationKind, id: m[2] } : null;
}

export function DestinationSelect({ value, onChange, departments, healthUnits, requireResponder = false, ...rest }: {
  value: string; onChange(value: string): void; departments: Destination[]; healthUnits: Destination[]; requireResponder?: boolean;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const item = (kind: DestinationKind, d: Destination) => {
    const off = requireResponder && !d.has_active_responder;
    return <option key={d.id} value={destinationValue(kind, d.id)} disabled={off}>{off ? `${d.name} — sem respondente` : d.name}</option>;
  };
  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value)} {...rest}>
      <option value="">Escolha o destino</option>
      <optgroup label="Setores">{departments.map((d) => item("department", d))}</optgroup>
      <optgroup label="Unidades">{healthUnits.map((u) => item("health_unit", u))}</optgroup>
    </select>
  );
}
