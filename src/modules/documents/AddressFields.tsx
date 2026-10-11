// Endereço completo (módulo 19d; Lei 5.991, art. 35; contrato §2 e §5): o do
// paciente na receita de controle especial e o do prescritor no perfil. Os
// campos são texto; a conversão para o corpo (CEP só dígitos, complemento
// omitido quando vazio) é de `addressInput`.
import { UFS, type AddressDraft } from "../../lib/controlled";
import { maskCep } from "../../lib/unitAddress";
import { inputStyle } from "../../components/formStyles";
import { box, labelStyle, legendStyle, rowStyle } from "./formStyles";

interface Props { legend: string; value: AddressDraft; onChange(next: AddressDraft): void }

export function AddressFields({ legend, value, onChange }: Props) {
  const set = (patch: Partial<AddressDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset aria-label={legend} style={box}>
      <legend style={legendStyle}>{legend}</legend>
      <div style={rowStyle}>
        <label style={{ ...labelStyle, flex: 2 }}>
          Logradouro
          <input value={value.street} style={inputStyle} onChange={(e) => set({ street: e.target.value })} />
        </label>
        <label style={labelStyle}>
          Número
          <input value={value.number} style={inputStyle} onChange={(e) => set({ number: e.target.value })} />
        </label>
        <label style={labelStyle}>
          Complemento
          <input value={value.complement} style={inputStyle} onChange={(e) => set({ complement: e.target.value })} />
        </label>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>
          Bairro
          <input value={value.district} style={inputStyle} onChange={(e) => set({ district: e.target.value })} />
        </label>
        <label style={labelStyle}>
          Cidade
          <input value={value.city} style={inputStyle} onChange={(e) => set({ city: e.target.value })} />
        </label>
        <label style={labelStyle}>
          UF
          <select value={value.uf} style={inputStyle} onChange={(e) => set({ uf: e.target.value })}>
            <option value="">escolha</option>
            {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          CEP
          <input inputMode="numeric" value={value.zip} style={inputStyle} onChange={(e) => set({ zip: maskCep(e.target.value) })} />
        </label>
      </div>
    </fieldset>
  );
}
