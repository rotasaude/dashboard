// Equipe da sala (módulo 29; F-29.1): quem vacina e quem responde pela sala. Só pessoas com o papel health_professional na Equipe da
// cidade, uma opção por pessoa e sem quem já tem o papel na sala. O api recusa o resto (cbo_not_allowed, room_lead_requires_nurse,
// professional_link_missing…) e a frase vem do mapa da vacinação. Vincular e desvincular passam pelo step-up. E-mail só na tela.
import { useState } from "react";
import { addRoomStaff, removeRoomStaff } from "../../lib/api";
import type { MembershipRow, VaccineRoom, VaccineRoomStaff, VaccineStaffRole } from "../../lib/api";
import { vaccinationError } from "../../lib/vaccination";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, list, muted, row } from "../exams/styles";
import { fieldsetStyle, statusStyle } from "../regulation/styles";

const ROLE_LABEL: Record<string, string> = { vaccinator: "Vacinador", room_lead: "Responsável pela sala" };
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

type Pending = { kind: "add"; userId: string; role: VaccineStaffRole } | { kind: "remove"; staff: VaccineRoomStaff } | null;

export function RoomStaffPanel({ room, memberships, onChanged, onGoToSecurity }: {
  room: VaccineRoom; memberships: MembershipRow[]; onChanged(): void; onGoToSecurity?(): void;
}) {
  const [ role, setRole ] = useState<VaccineStaffRole>("vaccinator");
  const [ userId, setUserId ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ pending, setPending ] = useState<Pending>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  const emailOf = (id: string) => memberships.find((m) => m.user.id === id)?.user.email_address ?? null;
  const shown = (s: VaccineRoomStaff) => s.name ?? emailOf(s.user_id) ?? "pessoa sem nome";
  const ident = (s: VaccineRoomStaff) => emailOf(s.user_id) ?? s.name ?? "pessoa";

  const taken = new Set(room.staff.filter((s) => s.role === role).map((s) => s.user_id));
  const people: { id: string; email: string }[] = [];
  for (const m of memberships) {
    if (m.role !== "health_professional" || taken.has(m.user.id) || people.some((p) => p.id === m.user.id)) continue;
    people.push({ id: m.user.id, email: m.user.email_address });
  }

  function link() {
    if (userId === "") { setError("escolha a pessoa"); return; }
    setError(null); setNotice(null);
    setPending({ kind: "add", userId, role });
  }

  function done(message: string) {
    setPending(null); setUserId(""); setNotice(message);
    onChanged();
  }

  return (
    <Panel title={`Equipe de ${room.name}`} sub="quem vacina nesta sala e quem responde por ela">
      <section aria-label="Equipe da sala" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {notice && <p role="status" style={statusStyle}>{notice}</p>}
        {room.staff.length === 0 && <p style={muted}>ninguém vinculado a esta sala</p>}
        {room.staff.length > 0 && (
          <ul style={list}>
            {room.staff.map((s) => (
              <li key={`${s.user_id}-${s.role}`} style={row}>
                <span>{shown(s)}</span>
                <span className="mono" style={muted}>{roleLabel(s.role)}</span>
                <button type="button" style={secondaryButtonStyle} disabled={pending !== null}
                  onClick={() => { setError(null); setNotice(null); setPending({ kind: "remove", staff: s }); }}>
                  {`Desvincular — ${ident(s)}`}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={box}>
          <fieldset disabled={pending !== null} style={fieldsetStyle}>
            <div style={row}>
              <label style={fieldLabel}>
                Papel na sala
                <select value={role} style={inputStyle} onChange={(e) => { setError(null); setRole(e.target.value as VaccineStaffRole); setUserId(""); }}>
                  <option value="vaccinator">{roleLabel("vaccinator")}</option>
                  <option value="room_lead">{roleLabel("room_lead")}</option>
                </select>
              </label>
              <label style={fieldLabel}>
                Pessoa
                <select value={userId} style={inputStyle} onChange={(e) => { setError(null); setUserId(e.target.value); }}>
                  <option value="">{people.length === 0 ? "ninguém disponível" : "escolha…"}</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
                </select>
              </label>
              <button type="button" style={buttonStyle} onClick={link}>Vincular</button>
            </div>
          </fieldset>
          {error && <p role="alert" style={alert}>{error}</p>}
          <span style={muted}>A pessoa precisa ser profissional de saúde da cidade, com vínculo na unidade da sala; o responsável pela sala é enfermeiro (CBO 2235).</span>
        </div>
        {pending?.kind === "add" && (
          <SensitiveAction
            title={`Vincular ${emailOf(pending.userId) ?? "a pessoa"} como ${roleLabel(pending.role).toLowerCase()} em ${room.name}`}
            description="A pessoa passa a atuar nesta sala com este papel. Dá para desvincular depois; as doses já registradas ficam."
            requiresStepUp
            confirmLabel="Vincular à sala"
            run={async () => { await addRoomStaff(room.id, pending.userId, pending.role); }}
            onDone={() => done("Vínculo registrado.")}
            onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => vaccinationError(err)}
          />
        )}
        {pending?.kind === "remove" && (
          <SensitiveAction
            title={`Desvincular ${ident(pending.staff)} (${roleLabel(pending.staff.role).toLowerCase()}) de ${room.name}`}
            description="A pessoa deixa de atuar nesta sala com este papel; as doses já registradas ficam."
            requiresStepUp
            confirmLabel="Confirmar desvínculo"
            run={async () => { await removeRoomStaff(room.id, pending.staff.user_id, pending.staff.role); }}
            onDone={() => done("Vínculo removido.")}
            onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => vaccinationError(err)}
          />
        )}
      </section>
    </Panel>
  );
}
