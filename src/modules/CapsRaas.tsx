// Módulo 31 — F-31.6: RAAS do mês (Task 11; P14, P15, P24, P42, P43, P57, P58). "Mês de atendimento": o corrente da cidade e os 12
// anteriores (nunca futuro; o relógio não congela — `today` por prop só em teste). A equipe lotada lê o mês (pendências, avisos e
// situação de rua por registro, `MonthRecords`); a coordenação fecha e reabre com step-up; coordenação e faturista veem remessa e
// fichas (`RaasExports`). O faturista nunca lê o mês nominal (403 `missing_role`, P43): para ele, só a lista de remessas do CAPS e do
// mês. O mês traz nomes: sem cache (`NOMINAL_QUERY`); chaves de consulta com o id do CAPS e o mês.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPsyMonth, type PsyUnit } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { monthLabel } from "../lib/regulation";
import { NOMINAL_QUERY, PSY_EXPORTS_KEY, PSY_MONTH_KEY, recentMonths, type PsyRoles } from "../lib/psychosocial";
import { inputStyle } from "../components/formStyles";
import { fieldLabel, row, stack } from "./exams/styles";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";
import { MonthRecords } from "./psychosocial/MonthRecords";
import { RaasExports } from "./psychosocial/RaasExports";

export type CapsRaasProps = { today?: string; onGoToSecurity?: () => void };

export function CapsRaas(props: CapsRaasProps) {
  return (
    <PsychosocialGate title="RAAS do mês" sub="Pendências, fechamento, remessa e fichas espelho" unit="any" allow={(r) => r.staff || r.billing}>
      {({ roles, unit }) => (unit ? <Raas unit={unit} roles={roles} {...props} /> : null)}
    </PsychosocialGate>
  );
}

function Raas({ unit, roles, today, onGoToSecurity }: CapsRaasProps & { unit: PsyUnit; roles: PsyRoles }) {
  const queryClient = useQueryClient();
  const months = recentMonths(today ?? todayInCity());
  const [ month, setMonth ] = useState(months[0]);
  const query = useQuery({
    queryKey: [ PSY_MONTH_KEY, unit.id, month ], queryFn: () => getPsyMonth(month, unit.id), enabled: roles.staff, ...NOMINAL_QUERY
  });
  const reloadMonth = () => queryClient.invalidateQueries({ queryKey: [ PSY_MONTH_KEY, unit.id ] });
  const reloadAll = async () => {
    await Promise.all([ reloadMonth(), queryClient.invalidateQueries({ queryKey: [ PSY_EXPORTS_KEY, unit.id ] }) ]);
  };
  // O mês escolhido continua na lista mesmo que a virada do mês o tire das 13.
  const choices = months.includes(month) ? months : [ ...months, month ];

  return (
    <div style={stack}>
      <div style={row}>
        <label style={fieldLabel}>
          Mês de atendimento
          <select value={month} style={inputStyle} onChange={(ev) => setMonth(ev.target.value)}>
            {choices.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>
      {roles.staff && (
        <MonthRecords key={`records:${month}`} unit={unit} month={month} query={query} roles={roles} onGoToSecurity={onGoToSecurity}
          reloadMonth={reloadMonth} reloadAll={reloadAll} />
      )}
      {(roles.lead || roles.billing) && (
        <RaasExports key={`exports:${month}`} unit={unit} month={month} roles={roles} monthStatus={roles.staff ? query.data?.status ?? null : null}
          onGoToSecurity={onGoToSecurity} onChanged={reloadAll} />
      )}
    </div>
  );
}
