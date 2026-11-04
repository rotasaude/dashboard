// Módulo 30 (F-30.2): "Viagens do dia" da central de transporte. Agenda por dia (e veículo), criar, editar, confirmar e cancelar viagem;
// em cada viagem, os passageiros (PassengerList) e, concluída, a correção de presença (AttendanceCorrection, com step-up).
// Leitura STATIC_QUERY (ao abrir, ao trocar o dia, depois de uma ação), sem polling. A resposta de uma ação feita antes de trocar o dia é
// ignorada (`epoch`), como o `seq` do PrescriptionLookup. A central nunca lê o laudo: nenhuma chamada a /tfd/*.
import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listDestinations, listDrivers, listTrips, listVehicles, type Trip } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import {
  NO_CLINICAL_NOTE, STATIC_QUERY, TR_DESTINATIONS_KEY, TR_DRIVERS_KEY, TR_TRIPS_KEY, TR_VEHICLES_KEY, transportError
} from "../lib/transport";
import { useActionMessage } from "../lib/useActionMessage";
import { ActionMessage } from "../components/ActionMessage";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { TransportGate } from "./transport/TransportGate";
import { AttendanceCorrection } from "./transport/AttendanceCorrection";
import { PassengerList } from "./transport/PassengerList";
import { TripCard } from "./transport/TripCard";
import { TripForm } from "./transport/TripForm";

export function TransportTrips({ today, onGoToSecurity }: { today?: string; onGoToSecurity?: () => void }) {
  return (
    <TransportGate title="Viagens do dia" sub="Agenda por dia e veículo, passageiros e lista impressa" area="transport" allow={(r) => r.dispatcher}>
      {() => <TripsAgenda today={today ?? todayInCity()} onGoToSecurity={onGoToSecurity} />}
    </TransportGate>
  );
}

function TripsAgenda({ today, onGoToSecurity }: { today: string; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const [ dayInput, setDayInput ] = useState(today);
  const [ vehicleInput, setVehicleInput ] = useState("");
  const [ filter, setFilter ] = useState<{ date: string; vehicleId: string | null }>({ date: today, vehicleId: null });
  const [ creating, setCreating ] = useState(false);
  const epoch = useRef(0);
  const msg = useActionMessage();

  const trips = useQuery({
    queryKey: [ TR_TRIPS_KEY, filter.date, filter.vehicleId ], queryFn: () => listTrips({ date: filter.date, vehicleId: filter.vehicleId }), ...STATIC_QUERY
  });
  // Lista completa (com inativos): a tela confere CNH e situação antes de confirmar; os seletores mostram só os ativos.
  const vehicles = useQuery({ queryKey: [ TR_VEHICLES_KEY ], queryFn: () => listVehicles(), ...STATIC_QUERY });
  const drivers = useQuery({ queryKey: [ TR_DRIVERS_KEY ], queryFn: () => listDrivers(), ...STATIC_QUERY });
  const destinations = useQuery({ queryKey: [ TR_DESTINATIONS_KEY ], queryFn: () => listDestinations(), ...STATIC_QUERY });

  const reload = () => { void trips.refetch(); };

  function choose(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayInput)) return;
    const next = { date: dayInput, vehicleId: vehicleInput === "" ? null : vehicleInput };
    // Mesmo dia e veículo: só relê; a ação em curso continua valendo.
    if (next.date === filter.date && next.vehicleId === filter.vehicleId) { reload(); return; }
    epoch.current += 1;
    msg.start(); setCreating(false);
    setFilter(next);
  }

  // Resposta de uma ação começada em outra data é ignorada.
  const at = epoch.current;
  function changed(_t: Trip | null, text: string) {
    if (at !== epoch.current) return;
    if (text) msg.ok(text);
    void queryClient.invalidateQueries({ queryKey: [ TR_TRIPS_KEY ] });
  }
  // T49: viagem criada em outro dia leva a agenda para o dia dela (o veículo escolhido continua).
  function showDayOf(t: Trip) {
    if (at !== epoch.current || t.date === filter.date) return;
    setDayInput(t.date);
    setFilter({ date: t.date, vehicleId: filter.vehicleId });
  }
  function refused() {
    if (at !== epoch.current) return;
    reload();
  }

  // Sem as listas a tela não confere CNH nem lotação e os seletores ficariam vazios: diz por quê e não oferece criar nem editar.
  const failed = [ vehicles, drivers, destinations ].find((q) => q.isError);
  const loadError = failed ? transportError(failed.error) : null;
  const vehicleList = vehicles.data ?? [];
  const driverList = drivers.data ?? [];
  const destinationList = destinations.data ?? [];
  const sorted = [ ...(trips.data ?? []) ].sort((a, b) => a.departure_at.localeCompare(b.departure_at));

  return (
    <Panel title="Agenda" sub="viagens do dia escolhido, em ordem de saída"
      right={<button type="button" style={secondaryButtonStyle} disabled={loadError !== null} aria-describedby={loadError ? "trips-load-error" : undefined}
        onClick={() => { msg.start(); setCreating(true); }}>Nova viagem</button>}>
      <div style={stack}>
        {loadError && <p id="trips-load-error" role="alert" style={alert}>{`Não foi possível carregar veículos, motoristas ou destinos: ${loadError}`}</p>}
        <form aria-label="Escolher o dia" style={{ ...row, alignItems: "flex-end" }} onSubmit={choose}>
          <div style={fieldLabel}>
            <label htmlFor="trips-day">Dia</label>
            <input id="trips-day" type="date" value={dayInput} style={inputStyle} onChange={(e) => setDayInput(e.target.value)} />
          </div>
          <div style={fieldLabel}>
            <label htmlFor="trips-vehicle">Veículo</label>
            <select id="trips-vehicle" value={vehicleInput} style={inputStyle} onChange={(e) => setVehicleInput(e.target.value)}>
              <option value="">Todos os veículos</option>
              {vehicleList.map((v) => <option key={v.id} value={v.id}>{`${v.plate} · ${v.model}`}</option>)}
            </select>
          </div>
          <button type="submit" style={buttonStyle}>Ver viagens</button>
        </form>

        {creating && loadError === null && (
          <TripForm date={filter.date} vehicles={vehicleList} drivers={driverList} destinations={destinationList}
            onSaved={(t) => { setCreating(false); showDayOf(t); changed(t, "Viagem criada."); }} onCancel={() => setCreating(false)} onRefused={refused} />
        )}
        <ActionMessage message={msg.message} />

        {trips.isError ? <p role="alert" style={alert}>{transportError(trips.error)}</p>
          : trips.isPending ? <p style={muted}>carregando…</p>
          : sorted.length === 0 ? <EmptyState title="nenhuma viagem neste dia" />
          : sorted.map((t) => (
            <TripCard key={t.id} trip={t} vehicles={vehicleList} drivers={driverList} destinations={destinationList}
              editBlocked={loadError} onChanged={changed} onReload={refused} onGoToSecurity={onGoToSecurity}>
              {/* A frase da ação fica junto da lista de passageiros; aqui a agenda só relê. */}
              <PassengerList trip={t} onChanged={() => changed(t, "")} onReload={refused} />
              <AttendanceCorrection trip={t} onCorrected={(c) => changed(c, "Presença corrigida.")} onReload={refused} onGoToSecurity={onGoToSecurity} />
            </TripCard>
          ))}
        <p style={muted}>{NO_CLINICAL_NOTE}</p>
      </div>
    </Panel>
  );
}
