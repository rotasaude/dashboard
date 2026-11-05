// Salas e rede de frio (módulo 29; F-29.1): salas por unidade, equipe da sala, rede de frio municipal com a equipe dela e a data do
// go-live. Só o municipal_admin (o portão); toda escrita passa pelo step-up, nas peças. Leituras estáticas (STATIC_QUERY): depois de
// cada escrita a chave certa é relida (VAC_ADMIN_KEY / VAC_SETTINGS_KEY). Molde do PharmacyAdmin.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColdChainCentral, listAllUnits, listMemberships, listVaccineRooms } from "../lib/api";
import { VAC_ADMIN_KEY, STATIC_QUERY, vaccinationError } from "../lib/vaccination";
import { Panel } from "../components/Panel";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle } from "../components/formStyles";
import { alert, muted, stack } from "./exams/styles";
import { VaccinationGate } from "./vaccination/VaccinationGate";
import { RoomsPanel } from "./vaccination/RoomsPanel";
import { RoomStaffPanel } from "./vaccination/RoomStaffPanel";
import { GoLivePanel } from "./vaccination/GoLivePanel";
import { StaffPanel } from "./pharmacy/StaffPanel";

const UNITS_KEY = "vaccinationUnits";
const MEMBERSHIPS_KEY = "vaccinationMemberships";
export const CENTRAL_NAME = "Rede de frio municipal";

export function VaccinationAdmin({ onGoToSecurity }: { onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Salas e rede de frio" sub="salas, vacinadores, rede de frio e início na cidade" allow={(r) => r.admin}>
      {() => <Body onGoToSecurity={onGoToSecurity} />}
    </VaccinationGate>
  );
}

function Body({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const admin = useQuery({ queryKey: [ VAC_ADMIN_KEY ], queryFn: listVaccineRooms, ...STATIC_QUERY });
  // Configuração da rede: o CAPS aparece pelo nome para o admin (de propósito, sem withoutCaps).
  const units = useQuery({ queryKey: [ UNITS_KEY ], queryFn: listAllUnits, ...STATIC_QUERY });
  const memberships = useQuery({ queryKey: [ MEMBERSHIPS_KEY ], queryFn: listMemberships, ...STATIC_QUERY });
  const [ selectedId, setSelectedId ] = useState<string | null>(null);
  const [ creating, setCreating ] = useState(false);

  const reload = () => { void queryClient.invalidateQueries({ queryKey: [ VAC_ADMIN_KEY ] }); };
  const selected = admin.data?.rooms.find((r) => r.id === selectedId) ?? null;
  const central = admin.data?.cold_chain_central ?? null;

  return (
    <div style={stack}>
      {admin.isPending && <p className="mono" style={muted}>carregando…</p>}
      {admin.isError && <p role="alert" style={alert}>{vaccinationError(admin.error)}</p>}
      {admin.data && (
        <RoomsPanel rooms={admin.data.rooms} units={units.data ?? []} selectedId={selectedId}
          onSelectStaff={setSelectedId} onSaved={reload} onGoToSecurity={onGoToSecurity} />
      )}
      {selected && (
        <RoomStaffPanel key={selected.id} room={selected} memberships={memberships.data ?? []} onChanged={reload} onGoToSecurity={onGoToSecurity} />
      )}
      {admin.data && (
        <Panel title="Rede de frio municipal" sub="o almoxarifado das vacinas da cidade e quem cuida dele">
          {central === null && (
            <div style={stack}>
              <p style={muted}>A cidade ainda não tem rede de frio. Só existe uma por cidade.</p>
              {!creating && <div><button type="button" style={buttonStyle} onClick={() => setCreating(true)}>Criar a rede de frio</button></div>}
              {creating && (
                <SensitiveAction
                  title={`Criar a rede de frio (${CENTRAL_NAME})`}
                  description="Cria o almoxarifado central das vacinas da cidade. Só pode haver um."
                  requiresStepUp
                  confirmLabel="Criar"
                  run={async () => { await createColdChainCentral(CENTRAL_NAME); }}
                  onDone={() => { setCreating(false); reload(); }}
                  onCancel={() => setCreating(false)}
                  onGoToSecurity={onGoToSecurity}
                  translateError={(err) => vaccinationError(err)}
                />
              )}
            </div>
          )}
          {central !== null && (
            <StaffPanel location={central} memberships={memberships.data ?? []} onChanged={reload} onGoToSecurity={onGoToSecurity} roles={[ "stock_keeper" ]} />
          )}
        </Panel>
      )}
      <GoLivePanel onGoToSecurity={onGoToSecurity} />
    </div>
  );
}
