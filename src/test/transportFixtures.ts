// Dados dos testes do módulo 30 (transporte e TFD). Hoje: terça, 2026-11-03, 10h. Formas do api (api-surface §3): onde o plano
// diz outra coisa, vale o api (motorista com `active`, série com `return_time`/`boarding_label`, processo com `version`,
// `submitted_at` e `patient.birth_date`, trecho com `companion`/`outbound_leg_id`/`voided`, códigos de ajuda sem `person`).
import type {
  SessionUser, TfdCase, TfdCaseRow, TfdLeg, TransportDestination, TransportDriver, TransportSeries, TransportSettings, TransportVehicle,
  Trip, TripPassenger
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const TODAY30 = "2026-11-03";
export const NOW30 = new Date("2026-11-03T10:00:00-03:00");
export const VAN: TransportVehicle = { id: "v1", plate: "ABC1D23", renavam: "12345678901", model: "Sprinter 415", kind: "van",
  renem_code: null, seats: 15, wheelchair_spots: 1, cnes: "2384299", active: true };
export const CAR: TransportVehicle = { ...VAN, id: "v2", plate: "XYZ9876", renavam: "10987654321", model: "Spin", kind: "car", seats: 4, wheelchair_spots: 0 };
export const DRIVER_D: TransportDriver = { id: "d1", user: { id: "u-d1", name: "João Motorista" }, license_category: "D",
  license_expires_on: "2028-05-10", license_status: "valid", license_number_last4: "4321", active: true };
export const DRIVER_B: TransportDriver = { ...DRIVER_D, id: "d2", user: { id: "u-d2", name: "Ana Condutora" }, license_category: "B",
  license_number_last4: "8765" };
export const DRIVER_EXPIRED: TransportDriver = { ...DRIVER_D, id: "d3", user: { id: "u-d3", name: "Pedro Vencido" },
  license_expires_on: "2026-10-30", license_status: "expired", license_number_last4: "1111" };
export const DRIVER_EXPIRING: TransportDriver = { ...DRIVER_D, id: "d4", user: { id: "u-d4", name: "Rita Avencer" },
  license_expires_on: "2026-11-20", license_status: "expiring", license_number_last4: "2222" };
export const DEST_CURITIBA: TransportDestination = { id: "t1", ibge_code: "4106902", name: "Curitiba", distance_km: 110, metropolitan: false, active: true };
export const DEST_NEAR: TransportDestination = { id: "t2", ibge_code: "4119905", name: "Ponta Grossa", distance_km: 30, metropolitan: false, active: true };
export const DEST_METRO: TransportDestination = { id: "t3", ibge_code: "4104204", name: "Campo Largo", distance_km: 60, metropolitan: true, active: true };
export const DEST_RURAL: TransportDestination = { id: "t4", ibge_code: "4100000", name: "Distrito de Santa Cruz", distance_km: 0, metropolitan: false, active: true };

// Visão da central (`/transport/trips`). A do motorista (`/transport/my_trips`) não traz `has_cpf` nem `cns_masked`: use driverView.
export function passenger(o: Partial<TripPassenger> = {}): TripPassenger {
  return { id: "p1", patient: { id: "pt1", display_name: "Maria da Silva", has_cpf: true, cns_masked: "*** **** **** 1234", phone_masked: "(41) ****-1234" },
    stop_id: "s1", destination: { destination_id: "t1", name: "Curitiba", provider_name: "Hospital Regional", address: "Rua XV, 100" },
    appointment_at: "2026-11-03T09:00:00-03:00", takes_seat: true, wheelchair: false, companion: null, origin: "regulation",
    exception_reason: null, attendance: "pending", companion_attendance: null, ...o };
}

export function trip(o: Partial<Trip> = {}): Trip {
  return { id: "tr1", date: TODAY30, departure_at: "2026-11-03T05:30:00-03:00", return_at: "2026-11-03T18:00:00-03:00",
    vehicle: { id: VAN.id, plate: VAN.plate, model: VAN.model, kind: VAN.kind, seats: VAN.seats, wheelchair_spots: VAN.wheelchair_spots },
    driver: { id: DRIVER_D.id, name: DRIVER_D.user.name }, status: "confirmed",
    stops: [ { id: "s1", position: 1, kind: "boarding", destination_id: null, label: "Praça da Matriz" },
      { id: "s2", position: 2, kind: "destination", destination_id: "t1", label: "Curitiba" } ],
    passengers: [ passenger() ], occupancy: { seats_used: 1, seats: 15, wheelchair_used: 0, wheelchair_spots: 1 }, series_id: null, log: null, ...o };
}

// O que o api manda ao motorista: o paciente sem `has_cpf` e sem `cns_masked`.
export function driverView(t: Trip): Trip {
  return { ...t, passengers: t.passengers.map((p) => ({ ...p, patient: { id: p.patient.id, display_name: p.patient.display_name, phone_masked: p.patient.phone_masked } })) };
}

export function series(o: Partial<TransportSeries> = {}): TransportSeries {
  return { id: "se1", patient: { id: "pt2", display_name: "José Hemodiálise" }, destination: { id: "t1", name: "Curitiba" },
    provider_name: "Clínica do Rim", weekdays: [ 1, 3, 5 ], appointment_time: "07:00", departure_time: "05:30", return_time: "12:00",
    boarding_label: "Praça da Matriz", starts_on: "2026-11-02", ends_on: null, wheelchair: false, companion: null, status: "active",
    suspended_from: null, ...o };
}

export function tfdLeg(o: Partial<TfdLeg> = {}): TfdLeg {
  return { id: "l1", direction: "outbound", mode: "bus_ticket", date: "2026-11-10", distance_km: 110, trip_passenger_id: null,
    ticket: { amount_cents: 8500, carrier: "Viação Graciosa" }, companion: false, outbound_leg_id: null, done: false, voided: false, ...o };
}

export function tfdCase(o: Partial<TfdCase> = {}): TfdCase {
  return { id: "c1", patient: { id: "pt1", display_name: "Maria da Silva", birth_date: "1958-04-12", has_cpf: true, cns_masked: "*** **** **** 1234" },
    status: "submitted", version: 2, submitted_at: "2026-11-02T14:00:00-03:00",
    requested_by: { name: "Dra. Clara", cbo: "225125" }, consultation_id: "co1", regulation_request_id: null,
    report: { sigtap_code: "0405050372", sigtap_name: "FACOEMULSIFICACAO", cid10: "H25.1", justification: "Sem oftalmologia cirúrgica no município.",
      companion_indicated: false, companion_reason: null, transport_mode: "fleet" },
    destination: DEST_CURITIBA, provider: { id: "cp1", name: "Hospital de Olhos" }, appointment_at: null, inpatient: [], legs: [], allowances: [],
    payments: [], accountability: null, trip_passengers: [],
    events: [ { kind: "created", at: "2026-11-02T13:50:00-03:00", by_name: "Dra. Clara", reason: null },
      { kind: "submitted", at: "2026-11-02T14:00:00-03:00", by_name: "Dra. Clara", reason: null } ], ...o };
}

export function tfdRow(o: Partial<TfdCaseRow> = {}): TfdCaseRow {
  return { id: "c1", patient: { display_name: "Maria da Silva" }, destination: { name: "Curitiba" }, status: "submitted", submitted_at: "2026-11-02T14:00:00-03:00", ...o };
}

// Os 10 códigos na ordem do arquivo do api (paciente, depois acompanhante, por tipo); `name` é "" quando a competência
// do SIGTAP do dia não traz o código. 0803010125 é ground_km (paciente), não meal_overnight.
export const SETTINGS: TransportSettings = { tfd_min_distance_km: 50, companion_rule: { max_age_child: 15, min_age_elderly: 60 },
  tfd_billing_health_unit_id: null, allowance_complements: {},
  allowance_codes: [
    { code: "0803010010", name: "AJUDA DE CUSTO PARA ALIMENTACAO/PERNOITE DE PACIENTE", kind: "meal_overnight" },
    { code: "0803010044", name: "AJUDA DE CUSTO PARA ALIMENTACAO/PERNOITE DE ACOMPANHANTE", kind: "meal_overnight" },
    { code: "0803010028", name: "AJUDA DE CUSTO PARA ALIMENTACAO DE PACIENTE SEM PERNOITE", kind: "meal_day" },
    { code: "0803010052", name: "AJUDA DE CUSTO PARA ALIMENTACAO DE ACOMPANHANTE SEM PERNOITE", kind: "meal_day" },
    { code: "0803010125", name: "UNIDADE DE REMUNERACAO P/ DESLOCAMENTO DE PACIENTE POR TRANSPORTE TERRESTRE (CADA 50 KM DE DISTANCIA)", kind: "ground_km" },
    { code: "0803010109", name: "UNIDADE DE REMUNERACAO P/ DESLOCAMENTO DE ACOMPANHANTE POR TRANSPORTE TERRESTRE (CADA 50 KM DE DISTANCIA)", kind: "ground_km" },
    { code: "0803010087", name: "UNIDADE DE REMUNERACAO P/ DESLOCAMENTO DE PACIENTE POR TRANSPORTE AEREO (CADA 200 MILHAS)", kind: "air_miles" },
    { code: "0803010079", name: "UNIDADE DE REMUNERACAO P/ DESLOCAMENTO DE ACOMPANHANTE POR TRANSPORTE AEREO (CADA 200 MILHAS)", kind: "air_miles" },
    { code: "0803010117", name: "UNIDADE DE REMUNERACAO P/ DESLOCAMENTO DE PACIENTE POR TRANSPORTE FLUVIAL (CADA 50 MILHAS)", kind: "river_miles" },
    { code: "0803010095", name: "", kind: "river_miles" }
  ] };

export function trUser(roles: string[] = [ "transport_dispatcher" ], features: string[] = [ "sanitary_transport", "tfd", "clinical_record" ]): SessionUser {
  return sessionWith(roles, { features });
}
