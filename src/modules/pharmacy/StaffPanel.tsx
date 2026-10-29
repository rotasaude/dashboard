// src/modules/pharmacy/StaffPanel.tsx
// Equipe do local (módulo 27a; F-27.1; contrato §3): o local escolhido na tabela. Cada vínculo mostra o nome (ou o e-mail de
// listMemberships quando a resposta vem sem nome) e o papel. "Papel no local" → "Pessoa": só quem TEM esse papel na Equipe da cidade
// (membership ativa) e ainda não está no local com ele; o api recusa o resto (role_not_granted, cbo_not_allowed). Vincular e
// desvincular passam pelo step-up e a tabela é relida depois. O e-mail só aparece na tela: nunca em URL, log ou storage.
import { useState } from "react";
import { addLocationStaff, removeLocationStaff } from "../../lib/api";
import type { AdminLocation, LocationStaff, MembershipRow, PharmacyRole } from "../../lib/api";
import { pharmacyError, pharmacyRoleLabel } from "../../lib/pharmacy";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, list, muted, row } from "../exams/styles";
import { fieldsetStyle, statusStyle } from "../regulation/styles";

const ROLES: PharmacyRole[] = [ "pharmacist", "pharmacy_assistant", "stock_keeper" ];

type Pending = { kind: "add"; userId: string; role: PharmacyRole } | { kind: "remove"; staff: LocationStaff } | null;

export function StaffPanel({ location, memberships, onChanged, onGoToSecurity }: {
  location: AdminLocation; memberships: MembershipRow[]; onChanged(): void; onGoToSecurity?(): void;
}) {
  const [ role, setRole ] = useState("");
  const [ userId, setUserId ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ pending, setPending ] = useState<Pending>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  const emailOf = (id: string) => memberships.find((m) => m.user.id === id)?.user.email_address ?? null;
  const shown = (s: LocationStaff) => s.name ?? emailOf(s.user_id) ?? "pessoa sem nome";
  const ident = (s: LocationStaff) => emailOf(s.user_id) ?? s.name ?? "pessoa";

  // Uma opção por pessoa (a mesma pessoa tem uma linha por papel em listMemberships).
  const taken = new Set(location.staff.filter((s) => s.role === role).map((s) => s.user_id));
  const people: { id: string; email: string }[] = [];
  for (const m of memberships) {
    if (m.role !== role || taken.has(m.user.id) || people.some((p) => p.id === m.user.id)) continue;
    people.push({ id: m.user.id, email: m.user.email_address });
  }

  function link() {
    if (role === "") { setError("escolha o papel no local"); return; }
    if (userId === "") { setError("escolha a pessoa"); return; }
    setError(null); setNotice(null);
    setPending({ kind: "add", userId, role: role as PharmacyRole });
  }

  function done(message: string) {
    setPending(null); setRole(""); setUserId(""); setNotice(message);
    onChanged();
  }

  return (
    <Panel title={`Equipe de ${location.name}`} sub="quem atua neste local, com o papel de cada um">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {notice && <p role="status" style={statusStyle}>{notice}</p>}
        {location.staff.length === 0 && <p style={muted}>ninguém vinculado a este local</p>}
        {location.staff.length > 0 && (
          <ul style={list}>
            {location.staff.map((s) => (
              <li key={`${s.user_id}-${s.role}`} style={row}>
                <span>{shown(s)}</span>
                <span className="mono" style={muted}>{pharmacyRoleLabel(s.role)}</span>
                <button type="button" style={secondaryButtonStyle} disabled={pending !== null}
                  onClick={() => { setError(null); setNotice(null); setPending({ kind: "remove", staff: s }); }}>
                  {`Desvincular ${ident(s)}`}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={box}>
          <fieldset disabled={pending !== null} style={fieldsetStyle}>
            <div style={row}>
              <label style={fieldLabel}>
                Papel no local
                <select value={role} style={inputStyle} onChange={(e) => { setError(null); setRole(e.target.value); setUserId(""); }}>
                  <option value="">escolha</option>
                  {ROLES.map((r) => <option key={r} value={r}>{pharmacyRoleLabel(r)}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                Pessoa
                <select value={userId} style={inputStyle} onChange={(e) => { setError(null); setUserId(e.target.value); }}>
                  <option value="">{role === "" ? "escolha o papel antes" : people.length === 0 ? "ninguém com este papel" : "escolha"}</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
                </select>
              </label>
              <button type="button" style={buttonStyle} onClick={link}>Vincular</button>
            </div>
          </fieldset>
          {error && <p role="alert" style={alert}>{error}</p>}
          <span style={muted}>A pessoa precisa ter o papel na Equipe da cidade; farmacêutico exige vínculo profissional com CBO 2234.</span>
        </div>
        {pending?.kind === "add" && (
          <SensitiveAction
            title={`Vincular ${emailOf(pending.userId) ?? "a pessoa"} como ${pharmacyRoleLabel(pending.role).toLowerCase()} em ${location.name}`}
            description="A pessoa passa a atuar neste local com este papel. Dá para desvincular depois; os registros já feitos ficam."
            requiresStepUp
            confirmLabel="Confirmar vínculo"
            run={async () => { await addLocationStaff(location.id, pending.userId, pending.role); }}
            onDone={() => done("Vínculo registrado.")}
            onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => pharmacyError(err)}
          />
        )}
        {pending?.kind === "remove" && (
          <SensitiveAction
            title={`Desvincular ${ident(pending.staff)} (${pharmacyRoleLabel(pending.staff.role).toLowerCase()}) de ${location.name}`}
            description="A pessoa deixa de atuar neste local com este papel; os registros já feitos ficam."
            requiresStepUp
            confirmLabel="Confirmar desvínculo"
            run={async () => { await removeLocationStaff(location.id, pending.staff.user_id, pending.staff.role); }}
            onDone={() => done("Vínculo removido.")}
            onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => pharmacyError(err)}
          />
        )}
      </div>
    </Panel>
  );
}
