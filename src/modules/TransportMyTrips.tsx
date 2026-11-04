// Módulo 30 (F-30.4): "Minhas viagens" do motorista, no celular. Só o dia de hoje (o motorista não navega datas); o api lista só as
// próprias viagens confirmadas, em andamento e concluídas. STATIC_QUERY com "Atualizar", sem polling. Usuário com o papel `driver`
// mas sem cadastro na frota: o api recusa com 403 `missing_role` e a tela diz que falta o cadastro.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listMyTrips, type Trip } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { STATIC_QUERY, TR_MY_TRIPS_KEY, transportError } from "../lib/transport";
import { EmptyState } from "../components/EmptyState";
import { secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, row, stack } from "./exams/styles";
import { TransportGate } from "./transport/TransportGate";
import { DriverTrip } from "./transport/DriverTrip";

const NOT_IN_FLEET = "você ainda não está cadastrado como motorista na frota";

export function TransportMyTrips({ today }: { today?: string; now?: Date }) {
  return (
    <TransportGate title="Minhas viagens" sub="Viagens do dia, embarque e fechamento" area="transport" allow={(r) => r.driver}>
      {() => <MyTrips today={today ?? todayInCity()} />}
    </TransportGate>
  );
}

function MyTrips({ today }: { today: string }) {
  const queryClient = useQueryClient();
  const key = [ TR_MY_TRIPS_KEY, today ];
  const trips = useQuery({ queryKey: key, queryFn: () => listMyTrips(today), ...STATIC_QUERY });

  // A resposta da ação já traz a viagem: troca no lugar (sem esperar a releitura). Uma releitura em curso é cancelada antes,
  // para não chegar depois e voltar a lista para trás (DFW1).
  function changed(t: Trip) {
    void queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<Trip[]>(key, (old) => old?.map((x) => (x.id === t.id ? t : x)));
    if (t.status === "done") void queryClient.invalidateQueries({ queryKey: [ TR_MY_TRIPS_KEY ] });
  }
  const reload = () => { void trips.refetch(); };

  const sorted = [ ...(trips.data ?? []) ].sort((a, b) => a.departure_at.localeCompare(b.departure_at));
  const notInFleet = trips.isError && errorCode(trips.error) === "missing_role";

  return (
    <div style={{ ...stack, maxWidth: "100%" }}>
      <div style={row}>
        <span style={muted}>{`Dia: ${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`}</span>
        <button type="button" style={{ ...secondaryButtonStyle, minHeight: 44 }} disabled={trips.isFetching} onClick={reload}>Atualizar</button>
      </div>
      {notInFleet ? <EmptyState title={NOT_IN_FLEET} />
        : trips.isError ? <p role="alert" style={alert}>{transportError(trips.error)}</p>
        : trips.isPending ? <p style={muted}>carregando…</p>
        : sorted.length === 0 ? <EmptyState title="nenhuma viagem sua hoje" />
        : sorted.map((t) => <DriverTrip key={t.id} trip={t} today={today} onChanged={changed} onReload={reload} />)}
    </div>
  );
}
