import { useState, type FormEvent } from "react";
import type { Professional, ProfessionalFields } from "../../lib/api";
import { COUNCILS, UFS, isValidCns, professionalError } from "../../lib/professionals";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";

// Formulário do perfil (spec §5). `selfService` mostra só nome e contato
// (emenda ao ADR 0021): conselho, registro e CNS a prefeitura confere.
interface Props {
  initial?: Partial<Professional>;
  submitLabel: string;
  selfService?: boolean;
  onSubmit(fields: ProfessionalFields): Promise<void>;
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function ProfileForm({ initial = {}, submitLabel, selfService = false, onSubmit }: Props) {
  const [ name, setName ] = useState(initial.professional_name ?? "");
  const [ council, setCouncil ] = useState(initial.council ?? "CRM");
  const [ uf, setUf ] = useState(initial.council_state ?? "PR");
  const [ registration, setRegistration ] = useState(initial.registration_number ?? "");
  const [ cns, setCns ] = useState("");
  const [ phone, setPhone ] = useState(initial.phone ?? "");
  const [ email, setEmail ] = useState(initial.contact_email ?? "");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ saved, setSaved ] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null); setSaved(false);
    const fields: ProfessionalFields = { professional_name: name, phone: phone || null, contact_email: email || null };
    if (!selfService) {
      // CNS em branco na edição = manter o atual (o formulário não o recebe em claro).
      if (cns || !initial.id) {
        if (!isValidCns(cns)) { setError("CNS inválido: confira os 15 dígitos"); return; }
        fields.cns = onlyDigits(cns);
      }
      Object.assign(fields, { council, council_state: uf, registration_number: onlyDigits(registration) });
    }
    setBusy(true);
    try {
      await onSubmit(fields);
      setSaved(true);
    } catch (err) {
      setError(professionalError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      {saved && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>Perfil salvo</p>}
      <label style={labelStyle}>Nome profissional
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      {!selfService && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ ...labelStyle, flex: 1 }}>Conselho
              <select value={council} onChange={(e) => setCouncil(e.target.value)} style={inputStyle}>
                {COUNCILS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ ...labelStyle, width: 90 }}>UF do conselho
              <select value={uf} onChange={(e) => setUf(e.target.value)} style={inputStyle}>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>
          <label style={labelStyle}>Número do registro
            <input value={registration} onChange={(e) => setRegistration(e.target.value)} style={inputStyle} inputMode="numeric" />
          </label>
          <label style={labelStyle}>CNS
            <input value={cns} onChange={(e) => setCns(e.target.value)} style={inputStyle} inputMode="numeric"
              placeholder={initial.cns_masked ? `${initial.cns_masked} (em branco mantém)` : "15 dígitos"} />
          </label>
        </>
      )}
      <label style={labelStyle}>Telefone profissional
        <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} inputMode="tel" />
      </label>
      <label style={labelStyle}>E-mail de contato
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} type="email" />
      </label>
      <div>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>{submitLabel}</button>
      </div>
    </form>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
