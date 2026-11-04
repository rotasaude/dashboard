// Módulo 30: "Frota, motoristas e destinos" (central de transporte). Três painéis empilhados; o portão é o mesmo filtro do menu.
import { TransportGate } from "./transport/TransportGate";
import { VehiclesPanel } from "./transport/VehiclesPanel";
import { DriversPanel } from "./transport/DriversPanel";
import { DestinationsPanel } from "./transport/DestinationsPanel";

export function TransportFleet() {
  return (
    <TransportGate title="Frota, motoristas e destinos" sub="Veículos, motoristas com CNH e destinos com km" area="transport" allow={(r) => r.dispatcher}>
      {() => (
        <>
          <VehiclesPanel />
          <DriversPanel />
          <DestinationsPanel />
        </>
      )}
    </TransportGate>
  );
}
