// Atendimentos marcados na data da viagem (módulo 30, F-30.2; D4; api-surface §8): regulação e TFD do dia e, só com uma unidade escolhida,
// a agenda da cidade (módulo 17; sem destino cadastrado — a central escolhe o destino da viagem). Busca nominal por mutação no clique
// (POST, tudo no corpo, sem cache), nunca sozinha. Série não é fonte. A sugestão mostra só origem, hora e local — nada clínico.
// As unidades vêm da rota do transporte (`GET /transport/health_units`, T46): toda central escolhe, sem papel extra.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { findScheduledCare, listTransportHealthUnits, type ScheduledCareItem, type Trip } from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import { STATIC_QUERY, originLabel, transportError } from "../../lib/transport";
import { NO_NAME } from "../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, list, muted, row } from "../exams/styles";

export function ScheduledCare({ trip, onPick }: { trip: Trip; onPick(item: ScheduledCareItem): void }) {
  const [ unitId, setUnitId ] = useState("");
  const units = useQuery({ queryKey: [ "transportHealthUnits" ], queryFn: () => listTransportHealthUnits(), ...STATIC_QUERY });
  const search = useMutation({ gcTime: 0, mutationFn: () => findScheduledCare({ date: trip.date, destinationId: null, healthUnitId: unitId || null }) });

  const onTrip = new Set(trip.passengers.map((p) => p.patient.id));
  const unitList = units.data ?? [];

  return (
    <section aria-label="Atendimentos marcados na data" style={form}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        {unitList.length > 0 && (
          <label style={fieldLabel}>
            Unidade (agenda da cidade)
            <select value={unitId} style={inputStyle} onChange={(e) => { setUnitId(e.target.value); search.reset(); }}>
              <option value="">Só regulação e TFD</option>
              {unitList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" style={search.isPending ? disabledButtonStyle : buttonStyle} disabled={search.isPending}
          onClick={() => { if (!search.isPending) search.mutate(); }}>
          Buscar atendimentos marcados na data
        </button>
      </div>
      {units.isError && <p role="alert" style={alert}>{`não foi possível ler as unidades da agenda da cidade: ${transportError(units.error)} — a busca segue só com regulação e TFD`}</p>}
      {search.isError && <p role="alert" style={alert}>{transportError(search.error)}</p>}
      {search.isSuccess && (search.data.length === 0 ? <p style={muted}>Nenhum atendimento marcado nesta data.</p> : (
        <ul style={list}>
          {search.data.map((item) => {
            const name = item.patient.display_name ?? NO_NAME;
            const where = item.destination.provider_name ?? "destino a escolher";
            return (
              <li key={`${item.origin}:${item.origin_id}`} style={row}>
                <span>{`${name} · ${originLabel(item.origin)} · ${fmtHourMinute(item.appointment_at)} · ${where}`}</span>
                {onTrip.has(item.patient.id) ? <span style={muted}>já nesta viagem</span> : (
                  <button type="button" style={secondaryButtonStyle} onClick={() => { search.reset(); onPick(item); }}>{`Pôr ${name} na viagem`}</button>
                )}
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
}
