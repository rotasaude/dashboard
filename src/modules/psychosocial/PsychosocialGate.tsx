// Portão das telas do CAPS (módulo 31): interruptor e papel antes de qualquer leitura (o api recusaria de novo; aqui só não se
// oferece a porta), e a escolha do CAPS. Molde do TransportGate com a escolha do LocationPick. `psychosocial_care` exige
// `clinical_record` (canUsePsychosocial). A lotação é do api: `GET /psychosocial/units` devolve os CAPS em que a equipe está lotada e,
// para o faturista, o admin e o analista, todos os CAPS ativos. Com um CAPS, entra direto; com vários, seletor. Trocar de CAPS remonta
// o corpo (`key`) e apaga o detalhe nominal do cache — nada do CAPS anterior sobra. Nada em storage.
import { Fragment, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listPsyUnits, type PsyUnit } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  NO_ACTIVE_CAPS, NO_CAPS_BEDS, NO_CAPS_UNIT, PSY_DETAIL_KEY, PSY_DISABLED, PSY_NO_ROLE, PSY_UNITS_KEY, STATIC_QUERY, canUsePsychosocial, modalityLabel, psyError,
  psychosocialRoles, type PsyRoles
} from "../../lib/psychosocial";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, stack } from "../exams/styles";

// "team": CAPS de lotação (a equipe); "any": o que o api devolver (faturista, admin e analista veem todos); "beds": só os com
// acolhimento noturno; "none": não lê (a tela escolhe sozinha, ou não depende de CAPS).
export type PsyUnitMode = "team" | "any" | "beds" | "none";

export function PsychosocialGate({ title, sub, allow, unit = "team", children }: {
  title: string; sub: string; allow(roles: PsyRoles): boolean; unit?: PsyUnitMode;
  children(ctx: { roles: PsyRoles; unit: PsyUnit | null }): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = psychosocialRoles(user);
  let body: ReactNode;
  if (!canUsePsychosocial(user)) body = <EmptyState title={PSY_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={PSY_NO_ROLE} />;
  else if (unit === "none") body = children({ roles, unit: null });
  else body = <UnitPick mode={unit} userId={user.id} roles={roles}>{(u) => children({ roles, unit: u })}</UnitPick>;
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}

function UnitPick({ mode, userId, roles, children }: {
  mode: Exclude<PsyUnitMode, "none">; userId: string; roles: PsyRoles; children(unit: PsyUnit): ReactNode;
}) {
  const queryClient = useQueryClient();
  const units = useQuery({ queryKey: [ PSY_UNITS_KEY, userId ], queryFn: listPsyUnits, ...STATIC_QUERY });
  const [ unitId, setUnitId ] = useState("");
  if (units.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (units.isError && !units.data) return <p role="alert" style={alert}>{psyError(units.error)}</p>;
  const options = (units.data ?? []).filter((u) => mode !== "beds" || u.night_capable);
  if (options.length === 0) {
    const empty = mode === "beds" ? NO_CAPS_BEDS : mode === "any" && !roles.staff ? NO_ACTIVE_CAPS : NO_CAPS_UNIT;
    return <EmptyState title={empty} />;
  }
  const current = options.find((u) => u.id === unitId) ?? options[0];
  const choose = (id: string) => {
    if (id === current.id) return;
    queryClient.removeQueries({ queryKey: [ PSY_DETAIL_KEY ] });
    setUnitId(id);
  };
  return (
    <div style={stack}>
      {options.length > 1 && (
        <label style={fieldLabel}>
          CAPS
          <select value={current.id} style={inputStyle} onChange={(e) => choose(e.target.value)}>
            {options.map((u) => <option key={u.id} value={u.id}>{`${u.name} · ${modalityLabel(u.caps_modality)}`}</option>)}
          </select>
        </label>
      )}
      <Fragment key={current.id}>{children(current)}</Fragment>
    </div>
  );
}
