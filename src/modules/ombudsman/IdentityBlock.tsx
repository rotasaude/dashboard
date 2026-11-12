// Identidade de quem fez a manifestação (módulo 33; contrato §8, Q24, Q50, Q57). Lida campo a campo, nunca espalhada:
// - `identified`: só `name`, `cpf_masked`, `phone_masked` (mostrados só se vierem mascarados) e, quando a chave existir, `contact`
//   (o digitado pela equipe, sem máscara, para retornar a ligação). CPF e telefone inteiros não saem do detalhe.
// - `preserved` e `anonymous`: só a frase, seja o que for que o api mande em `identity` ou no topo do detalhe.
// O ouvidor abre a identidade em qualquer modo (`can.open_identity`, Q50) pelo botão, que abre o `IdentityDialog` (justificativa).
import type { OmbudsmanManifestation } from "../../lib/api";
import { ANONYMOUS_NO_IDENTITY, IDENTITY_PRESERVED, canSeeIdentityButton, type OmbudsmanRoles } from "../../lib/ombudsman";
import { KeyValue } from "../../components/KeyValue";
import { Panel } from "../../components/Panel";
import { secondaryButtonStyle } from "../../components/formStyles";
import { grid, muted } from "../exams/styles";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
// Campo "mascarado" que chegue sem máscara (por engano) não vai à tela.
const masked = (v: unknown): string | null => { const s = text(v); return s && s.includes("*") ? s : null; };

type Shown = { name: string | null; cpf: string | null; phone: string | null; contact: string | null };

function identifiedFields(m: OmbudsmanManifestation): Shown | null {
  if (m.identification_mode !== "identified" || !m.identity || typeof m.identity !== "object") return null;
  const r = m.identity as unknown as Record<string, unknown>;
  return { name: text(r.name), cpf: masked(r.cpf_masked), phone: masked(r.phone_masked), contact: text(r.contact) };
}

export function IdentityBlock({ m, roles, onReveal }: { m: OmbudsmanManifestation; roles: OmbudsmanRoles; onReveal(opener: HTMLElement): void }) {
  const shown = identifiedFields(m);
  const phrase = m.identification_mode === "anonymous" && !m.identity_available ? ANONYMOUS_NO_IDENTITY : IDENTITY_PRESERVED;
  const button = canSeeIdentityButton(m, roles)
    ? <button type="button" style={secondaryButtonStyle} onClick={(ev) => onReveal(ev.currentTarget)}>Ver identidade</button>
    : undefined;
  return (
    <Panel title="Identidade" right={button}>
      {shown ? (
        <div style={grid}>
          <KeyValue k="Nome" v={shown.name ?? "—"} mono={false} />
          <KeyValue k="CPF" v={shown.cpf ?? "—"} />
          <KeyValue k="Telefone" v={shown.phone ?? "—"} />
          {shown.contact && <KeyValue k="Contato" v={shown.contact} mono={false} />}
        </div>
      ) : (
        <p style={muted}>{phrase}</p>
      )}
    </Panel>
  );
}
