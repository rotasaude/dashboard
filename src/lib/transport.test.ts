import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  canUseTransport, closeBody, closeProblems, destinationProblems, driverCreateBody, driverFitProblems, driverProblems, driverUpdateBody, fmtCents,
  fmtTransportCount, isDriverOnly, licenseText, licenseTone, newTripDraft, normalizePlate, occupancyText, originLabel, parseLiters, parseReais,
  passengerBody, passengerDraftFrom, passengerProblems, pendingAttendance, pendingReasonLabel, seriesBody, seriesProblems, transportError,
  LocalRefusal, REASON_TEXT, isStaleRefusal, reasonProblemText, refusalTexts, transportRefusals, transportRoles, tripBody, tripDraftFrom, tripProblems, tripStatusLabel, tripStatusTone, vehicleBody, vehicleProblems,
  weekdaysLabel
} from "./transport";
import { CAR, DRIVER_B, DRIVER_D, DRIVER_EXPIRED, DRIVER_EXPIRING, TODAY30, VAN, passenger, trip, trUser } from "../test/transportFixtures";

const codes = (list: { path: string }[]) => list.map((p) => p.path);
const refuse = (status: number, body: Record<string, unknown>) => new ApiError(status, body, String(status));

describe("portão e papéis", () => {
  it("interruptor e operador", () => {
    expect(canUseTransport(trUser())).toBe(true);
    expect(canUseTransport(trUser([ "transport_dispatcher" ], []))).toBe(false);
    expect(canUseTransport({ ...trUser(), operator: true })).toBe(false);
  });
  it("isDriverOnly: só com driver e nada mais", () => {
    expect(isDriverOnly(trUser([ "driver" ]))).toBe(true);
    expect(isDriverOnly(trUser([ "driver", "viewer" ]))).toBe(false);
    expect(isDriverOnly(trUser([]))).toBe(false);
    expect(isDriverOnly(null)).toBe(false);
    expect(isDriverOnly({ ...trUser([ "driver" ]), operator: true })).toBe(false);
  });
  it("transportRoles separa os cinco papéis", () => {
    expect(transportRoles(trUser([ "transport_dispatcher", "tfd_committee" ]))).toEqual(
      { dispatcher: true, driver: false, admin: false, committee: true, professional: false });
    expect(transportRoles(trUser([ "driver", "municipal_admin", "health_professional" ]))).toEqual(
      { dispatcher: false, driver: true, admin: true, committee: false, professional: true });
  });
});

describe("frota", () => {
  const base = { plate: "ABC1D23", renavam: "12345678901", model: "Sprinter", kind: "van", renem_code: "", seats: "15", wheelchair_spots: "1", cnes: "", active: true };
  it("placa antiga e Mercosul; hífen e minúscula normalizam; outra coisa recusa", () => {
    expect(normalizePlate("abc-1234")).toBe("ABC1234");
    expect(normalizePlate(" ab c1d23 ")).toBe("ABC1D23");
    expect(vehicleProblems(base)).toEqual([]);
    expect(vehicleProblems({ ...base, plate: "abc-1234" })).toEqual([]);
    expect(codes(vehicleProblems({ ...base, plate: "AB12345", renavam: "123", seats: "0", cnes: "12" }))).toEqual([ "plate", "renavam", "seats", "cnes" ]);
  });
  it("limites de modelo, lugares, cadeiras e RENEM", () => {
    expect(codes(vehicleProblems({ ...base, model: "A", seats: "61", wheelchair_spots: "11", renem_code: "x".repeat(21) })))
      .toEqual([ "model", "renem_code", "seats", "wheelchair_spots" ]);
    expect(codes(vehicleProblems({ ...base, seats: "1,5", wheelchair_spots: "-1" }))).toEqual([ "seats", "wheelchair_spots" ]);
  });
  it("corpo: CNES e RENEM vazios vão nulos, números viram inteiros", () => {
    expect(vehicleBody({ ...base, plate: "abc-1234", model: " Sprinter " })).toEqual({
      plate: "ABC1234", renavam: "12345678901", model: "Sprinter", kind: "van", renem_code: null, seats: 15, wheelchair_spots: 1, cnes: null, active: true });
    expect(vehicleBody({ ...base, cnes: "2384299", renem_code: "R1" })).toMatchObject({ cnes: "2384299", renem_code: "R1" });
  });
  it("motorista: CNH só é obrigatória ao criar; na edição vazia mantém", () => {
    const d = { userId: "u1", licenseNumber: "12345678901", licenseCategory: "D", licenseExpiresOn: "2028-01-01", active: true };
    expect(driverProblems(d, true)).toEqual([]);
    expect(codes(driverProblems({ ...d, userId: "", licenseNumber: "", licenseCategory: "", licenseExpiresOn: "" }, true)))
      .toEqual([ "user_id", "license_number", "license_category", "license_expires_on" ]);
    expect(driverProblems({ ...d, userId: "", licenseNumber: "" }, false)).toEqual([]);
    expect(codes(driverProblems({ ...d, licenseNumber: "123" }, false))).toEqual([ "license_number" ]);
    expect(driverCreateBody(d)).toEqual({ user_id: "u1", license_number: "12345678901", license_category: "D", license_expires_on: "2028-01-01", active: true });
    const upd = driverUpdateBody({ ...d, licenseNumber: "" });
    expect(upd).toEqual({ license_category: "D", license_expires_on: "2028-01-01", active: true });
    expect("user_id" in upd || "license_number" in upd).toBe(false);
    expect(driverUpdateBody(d)).toHaveProperty("license_number", "12345678901");
  });
  it("destino: IBGE 7 dígitos, nome 2–120, distância inteira 0–9999", () => {
    const d = { ibgeCode: "4106902", name: "Curitiba", distanceKm: "110", metropolitan: false, active: true };
    expect(destinationProblems(d)).toEqual([]);
    expect(destinationProblems({ ...d, distanceKm: "0" })).toEqual([]);
    expect(codes(destinationProblems({ ...d, ibgeCode: "41", name: "C", distanceKm: "10000" }))).toEqual([ "ibge_code", "name", "distance_km" ]);
    expect(codes(destinationProblems({ ...d, distanceKm: "1,5" }))).toEqual([ "distance_km" ]);
  });
});

describe("CNH e categoria (Review Focus 3)", () => {
  it("driverFitProblems: vencida, categoria, a vencer não bloqueia", () => {
    expect(driverFitProblems(DRIVER_EXPIRED, VAN, TODAY30).map((p) => p.text)).toEqual([ "a CNH deste motorista está vencida na data da viagem" ]);
    expect(driverFitProblems(DRIVER_B, VAN, TODAY30).map((p) => p.text)).toEqual([ "veículo com mais de 8 lugares exige CNH D ou E" ]);
    expect(driverFitProblems(DRIVER_B, CAR, TODAY30)).toEqual([]);
    expect(driverFitProblems(DRIVER_B, { seats: 8 }, TODAY30)).toEqual([]);
    expect(driverFitProblems({ ...DRIVER_D, license_category: "C" }, { seats: 9 }, TODAY30)).toHaveLength(1);
    expect(driverFitProblems(DRIVER_EXPIRING, VAN, TODAY30)).toEqual([]);
    expect(driverFitProblems(undefined, VAN, TODAY30)).toEqual([]);
    // Vence antes da viagem marcada para depois: conta a data da viagem, não hoje.
    expect(driverFitProblems(DRIVER_EXPIRING, VAN, "2026-11-25")).toHaveLength(1);
    // Vence no próprio dia da viagem: ainda vale.
    expect(driverFitProblems(DRIVER_EXPIRING, VAN, "2026-11-20")).toEqual([]);
  });
  it("texto e tom da CNH", () => {
    expect(licenseText(DRIVER_EXPIRING)).toBe("CNH vence em 20/11/2026");
    expect(licenseText(DRIVER_EXPIRED)).toBe("CNH vencida em 30/10/2026");
    expect(licenseText(DRIVER_D)).toBe("CNH D válida até 10/05/2028");
    expect([ DRIVER_D, DRIVER_EXPIRING, DRIVER_EXPIRED ].map(licenseTone)).toEqual([ "ok", "warn", "down" ]);
    expect(licenseTone({ ...DRIVER_D, license_status: "novo" })).toBe("neutral");
    expect(licenseText({ ...DRIVER_D, license_status: "novo" })).toContain("novo");
  });
});

describe("viagem", () => {
  const ctx = { vehicles: [ VAN, CAR ], drivers: [ DRIVER_D, DRIVER_B, DRIVER_EXPIRED ], confirm: false };
  it("retorno antes da saída recusa; planejada sem veículo é aceita; confirmar exige os dois", () => {
    const d = { ...newTripDraft(TODAY30), departureTime: "05:30", returnTime: "05:00", boarding: [ "Praça da Matriz" ], destinationIds: [ "t1" ] };
    expect(codes(tripProblems(d, ctx))).toEqual([ "return_at" ]);
    const ok = { ...d, returnTime: "18:00" };
    expect(tripProblems(ok, ctx)).toEqual([]);
    expect(codes(tripProblems(ok, { ...ctx, confirm: true }))).toEqual([ "vehicle_id", "driver_id" ]);
    expect(codes(tripProblems({ ...ok, vehicleId: "v1", driverId: "d2" }, { ...ctx, confirm: true }))).toEqual([ "driver_id" ]);
    expect(tripProblems({ ...ok, vehicleId: "v1", driverId: "d1" }, { ...ctx, confirm: true })).toEqual([]);
  });
  it("paradas: um embarque (3 a 120) e um destino; retorno até 72 h", () => {
    const ok = { ...newTripDraft(TODAY30), departureTime: "05:30", returnTime: "18:00", boarding: [ "Praça" ], destinationIds: [ "t1" ] };
    expect(codes(tripProblems({ ...ok, boarding: [], destinationIds: [] }, ctx))).toEqual([ "boarding", "destinations" ]);
    expect(codes(tripProblems({ ...ok, boarding: [ "ab" ] }, ctx))).toEqual([ "boarding" ]);
    expect(codes(tripProblems({ ...ok, returnDate: "2026-11-07" }, ctx))).toEqual([ "return_at" ]);
    expect(codes(tripProblems({ ...ok, departureTime: "", returnTime: "" }, ctx))).toEqual([ "departure_at", "return_at" ]);
  });
  it("veículo ou motorista inativo, CNH vencida e categoria aparecem no motorista/veículo", () => {
    const ok = { ...newTripDraft(TODAY30), departureTime: "05:30", returnTime: "18:00", boarding: [ "Praça" ], destinationIds: [ "t1" ] };
    expect(tripProblems({ ...ok, vehicleId: "v1" }, { ...ctx, vehicles: [ { ...VAN, active: false } ] }).map((p) => p.text)).toEqual([ "este veículo está inativo" ]);
    expect(tripProblems({ ...ok, driverId: "d1" }, { ...ctx, drivers: [ { ...DRIVER_D, active: false } ] }).map((p) => p.text)).toEqual([ "este motorista está inativo" ]);
    expect(tripProblems({ ...ok, vehicleId: "v1", driverId: "d3" }, ctx).map((p) => p.text)).toEqual([ "a CNH deste motorista está vencida na data da viagem" ]);
  });
  it("corpo: hora de parede da cidade, retorno no dia seguinte, paradas em ordem", () => {
    const d = { ...newTripDraft(TODAY30), departureTime: "22:00", returnDate: "2026-11-04", returnTime: "06:00", boarding: [ "Praça", "Distrito" ], destinationIds: [ "t1" ] };
    const body = tripBody(d);
    expect(body.date).toBe(TODAY30);
    expect(body.departure_at).toBe("2026-11-03T22:00:00-03:00");
    expect(body.return_at).toBe("2026-11-04T06:00:00-03:00");
    expect(body.stops.map((s) => [ s.position, s.kind, s.label ])).toEqual([ [ 1, "boarding", "Praça" ], [ 2, "boarding", "Distrito" ], [ 3, "destination", "" ] ]);
    expect(body.stops[2].destination_id).toBe("t1");
    expect("destination_id" in body.stops[0]).toBe(false);
    expect("vehicle_id" in body).toBe(false);
    expect("driver_id" in body).toBe(false);
    expect(tripBody({ ...d, vehicleId: "v1", driverId: "d1" })).toMatchObject({ vehicle_id: "v1", driver_id: "d1" });
  });
  it("edição manda null para veículo e motorista limpos; criação omite", () => {
    const d = { ...tripDraftFrom(trip()), vehicleId: "", driverId: "" };
    expect(tripBody(d, { edit: true })).toMatchObject({ vehicle_id: null, driver_id: null });
    const create = tripBody(d);
    expect("vehicle_id" in create || "driver_id" in create).toBe(false);
    expect(tripBody({ ...d, vehicleId: "v1" }, { edit: true })).toMatchObject({ vehicle_id: "v1", driver_id: null });
  });
  it("trip_not_open cobre viagem já iniciada", () => {
    expect(transportError(refuse(422, { error: "trip_not_open" }))).toContain("já começou");
  });
  it("série: fim no passado não é recusado pela tela (o api só confere fim >= início)", () => {
    const d = { patientId: "p", destinationId: "t1", providerName: "", weekdays: [ 1 ], appointmentTime: "07:00", departureTime: "05:30", returnTime: "12:00",
      boardingLabel: "Praça", startsOn: "2026-01-01", endsOn: "2026-02-01", wheelchair: false, companion: null };
    expect(seriesProblems(d, TODAY30)).toEqual([]);
  });
  it("paradas saem sem id e só com as chaves do contrato (o TripForm devolve os ids, D3)", () => {
    const body = tripBody({ ...tripDraftFrom(trip()), boarding: [ "Praça da Matriz", "Distrito novo" ] });
    expect(body.stops.map((s) => [ s.id, s.kind ])).toEqual([ [ undefined, "boarding" ], [ undefined, "boarding" ], [ undefined, "destination" ] ]);
    expect(body.stops.every((s) => Object.keys(s).every((k) => [ "position", "kind", "destination_id", "label" ].includes(k)))).toBe(true);
  });
  it("tripDraftFrom lê a viagem na hora da cidade", () => {
    const d = tripDraftFrom(trip());
    expect(d).toMatchObject({ date: TODAY30, departureTime: "05:30", returnDate: TODAY30, returnTime: "18:00", vehicleId: "v1", driverId: "d1",
      boarding: [ "Praça da Matriz" ], destinationIds: [ "t1" ] });
    expect(tripDraftFrom(trip({ vehicle: null, driver: null }))).toMatchObject({ vehicleId: "", driverId: "" });
  });
  it("ocupação", () => {
    expect(occupancyText(trip())).toBe("1 de 15 lugares · 0 de 1 cadeira");
    expect(occupancyText(trip({ occupancy: { seats_used: 2, seats: 4, wheelchair_used: 0, wheelchair_spots: 0 } }))).toBe("2 de 4 lugares · 0 de 0 cadeiras");
    expect(occupancyText(trip({ vehicle: null, occupancy: { seats_used: 3, seats: null, wheelchair_used: 0, wheelchair_spots: null } }))).toBe("3 lugares ocupados · sem veículo");
  });
  it("rótulos de situação; código novo aparece cru", () => {
    expect([ "planned", "confirmed", "in_progress", "done", "cancelled" ].map(tripStatusLabel)).toEqual([ "planejada", "confirmada", "em andamento", "concluída", "cancelada" ]);
    expect([ "planned", "confirmed", "in_progress", "done", "cancelled", "x" ].map(tripStatusTone)).toEqual([ "info", "ok", "info", "neutral", "down", "neutral" ]);
    expect(tripStatusLabel("nova")).toBe("nova");
  });
});

describe("passageiro", () => {
  const full = trip({ occupancy: { seats_used: 15, seats: 15, wheelchair_used: 1, wheelchair_spots: 1 } });
  const base = { patientId: "pt9", origin: "exception", originId: "", exceptionReason: "", exceptionNote: "", stopId: "s1", destinationId: "t1",
    providerName: "", address: "", appointmentAt: "", takesSeat: true, wheelchair: false, companion: null } as const;
  it("sem motivo; outro sem texto; lotado; cadeira", () => {
    expect(codes(passengerProblems({ ...base }, trip()))).toEqual([ "exception_reason" ]);
    expect(codes(passengerProblems({ ...base, exceptionReason: "other", exceptionNote: "curto" }, trip()))).toEqual([ "exception_note" ]);
    expect(codes(passengerProblems({ ...base, exceptionReason: "follow_up_return", wheelchair: true }, full))).toEqual([ "takes_seat", "wheelchair" ]);
    expect(passengerProblems({ ...base, exceptionReason: "follow_up_return", takesSeat: false }, full)).toEqual([]);
  });
  it("acompanhante também ocupa lugar: 14 de 15 comporta o paciente só sem acompanhante", () => {
    const almost = trip({ occupancy: { seats_used: 14, seats: 15, wheelchair_used: 0, wheelchair_spots: 1 } });
    const ok = { ...base, exceptionReason: "follow_up_return" } as const;
    expect(passengerProblems(ok, almost)).toEqual([]);
    expect(codes(passengerProblems({ ...ok, companion: { name: "Joana Silva", document: "", reason: "" } }, almost))).toEqual([ "takes_seat" ]);
  });
  it("viagem sem veículo não confere lotação", () => {
    const none = trip({ vehicle: null, occupancy: { seats_used: 3, seats: null, wheelchair_used: 0, wheelchair_spots: null } });
    expect(passengerProblems({ ...base, exceptionReason: "follow_up_return", wheelchair: true }, none)).toEqual([]);
  });
  it("origem que não é exceção exige o atendimento; exceção não leva origin_id", () => {
    expect(codes(passengerProblems({ ...base, origin: "regulation" }, trip()))).toEqual([ "origin_id" ]);
    expect(passengerProblems({ ...base, origin: "regulation", originId: "r1" }, trip())).toEqual([]);
  });
  it("paciente, parada e destino obrigatórios", () => {
    expect(codes(passengerProblems({ ...base, exceptionReason: "legacy_patient", patientId: "", stopId: "", destinationId: "" }, trip())))
      .toEqual([ "patient_id", "stop_id", "destination_id" ]);
  });
  it("acompanhante: nome 3–120, documento até 20, motivo 10–500 quando dado; caminhos pontuados do api", () => {
    const ok = { ...base, exceptionReason: "legacy_patient" } as const;
    expect(codes(passengerProblems({ ...ok, companion: { name: "", document: "", reason: "" } }, trip()))).toEqual([ "companion.name" ]);
    expect(codes(passengerProblems({ ...ok, companion: { name: "Joana", document: "1".repeat(21), reason: "curto" } }, trip())))
      .toEqual([ "companion.document", "companion.reason" ]);
    expect(passengerProblems({ ...ok, companion: { name: "Joana", document: "", reason: "" } }, trip())).toEqual([]);
  });
  it("texto livre longo demais: endereço e local", () => {
    const ok = { ...base, exceptionReason: "legacy_patient" } as const;
    expect(codes(passengerProblems({ ...ok, providerName: "x".repeat(121), address: "y".repeat(201) }, trip()))).toEqual([ "provider_name", "address" ]);
  });
  it("sugestão vira rascunho e o corpo só leva as chaves da origem", () => {
    const item = { patient: { id: "pt1", display_name: "Maria", has_cpf: true, cns_masked: null, phone_masked: null }, origin: "regulation", origin_id: "r1",
      appointment_at: "2026-11-03T09:00:00-03:00", destination: { destination_id: "t1", provider_name: "Hospital Regional", address: null } };
    const d = passengerDraftFrom(item, "s1");
    expect(d).toMatchObject({ patientId: "pt1", origin: "regulation", originId: "r1", stopId: "s1", destinationId: "t1", providerName: "Hospital Regional",
      address: "", appointmentAt: "2026-11-03T09:00", takesSeat: true, wheelchair: false, companion: null });
    expect(passengerBody(d)).toEqual({ patient_id: "pt1", origin: "regulation", origin_id: "r1", stop_id: "s1", destination_id: "t1",
      provider_name: "Hospital Regional", appointment_at: "2026-11-03T09:00:00-03:00", takes_seat: true, wheelchair: false });
    const ex = passengerBody({ ...base, exceptionReason: "other", exceptionNote: " motivo escrito aqui ", companion: { name: " Joana Silva ", document: "", reason: "" } });
    expect(ex).toEqual({ patient_id: "pt9", origin: "exception", exception_reason: "other", exception_note: "motivo escrito aqui", stop_id: "s1",
      destination_id: "t1", takes_seat: true, wheelchair: false, companion: { name: "Joana Silva" } });
    expect("origin_id" in ex).toBe(false);
  });
});

describe("dinheiro e contagens", () => {
  it("parseReais aceita vírgula, ponto e milhar; recusa três casas e negativo", () => {
    expect(parseReais("12,34")).toBe(1234);
    expect(parseReais("12.34")).toBe(1234);
    expect(parseReais("1.234,56")).toBe(123456);
    expect(parseReais("1234")).toBe(123400);
    expect(parseReais("12,5")).toBe(1250);
    expect(parseReais("12,345")).toBeNull();
    expect(parseReais("1.234")).toBe(123400);
    expect(parseReais("0.500")).toBeNull();
    expect(parseReais("1.234,567")).toBeNull();
    expect(parseReais("-5")).toBeNull();
    expect(parseReais("")).toBeNull();
    expect(parseReais("abc")).toBeNull();
  });
  it("parseLiters: até duas casas, entre 0 e 1000", () => {
    expect(parseLiters("40,5")).toBe(40.5);
    expect(parseLiters("40.25")).toBe(40.25);
    expect(parseLiters("0")).toBeNull();
    expect(parseLiters("1000,01")).toBeNull();
    expect(parseLiters("1,234")).toBeNull();
    expect(parseLiters("x")).toBeNull();
  });
  it("fmtCents e lt5", () => {
    expect(fmtCents(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(fmtTransportCount("lt5")).toBe("menos de 5");
    expect(fmtTransportCount(12)).toBe("12");
    expect(fmtTransportCount(0)).toBe("0");
    expect(fmtTransportCount(1234)).toBe("1.234");
  });
});

describe("fechamento", () => {
  const empty = { odometerStart: "1000", odometerEnd: "900", fuel: [], expenses: [] };
  it("odômetro e presença pendente (caminho passengers, o do api)", () => {
    const t = trip({ status: "in_progress" });
    expect(codes(closeProblems(empty, t))).toEqual([ "odometer_end", "passengers" ]);
    const ok = trip({ status: "in_progress", passengers: [ passenger({ attendance: "boarded" }) ] });
    expect(closeProblems({ ...empty, odometerEnd: "1220", fuel: [ { liters: "40,5", amount: "250,00", station: "Posto Central" } ] }, ok)).toEqual([]);
    expect(codes(closeProblems({ ...empty, odometerEnd: "1220", fuel: [ { liters: "0", amount: "x", station: "" } ] }, ok)))
      .toEqual([ "fuel.0.liters", "fuel.0.amount_cents", "fuel.0.station" ]);
  });
  it("odômetro não inteiro ou acima do limite", () => {
    const ok = trip({ passengers: [] });
    expect(codes(closeProblems({ ...empty, odometerStart: "", odometerEnd: "1,5" }, ok))).toEqual([ "odometer_start", "odometer_end" ]);
    expect(codes(closeProblems({ ...empty, odometerEnd: "10000000" }, ok))).toEqual([ "odometer_end" ]);
  });
  it("despesa: tipo, valor e observação; observação é opcional em qualquer tipo", () => {
    const ok = trip({ passengers: [] });
    const d = { ...empty, odometerEnd: "1100" };
    expect(closeProblems({ ...d, expenses: [ { kind: "other", amount: "10,00", note: "" } ] }, ok)).toEqual([]);
    expect(codes(closeProblems({ ...d, expenses: [ { kind: "", amount: "0", note: "x".repeat(121) } ] }, ok)))
      .toEqual([ "expenses.0.kind", "expenses.0.amount_cents", "expenses.0.note" ]);
    expect(codes(closeProblems({ ...d, expenses: [ { kind: "toll", amount: "5", note: "" }, { kind: "meal", amount: "", note: "" } ] }, ok)))
      .toEqual([ "expenses.1.amount_cents" ]);
  });
  it("valor acima de R$ 100.000,00 e mais de 20 linhas", () => {
    const ok = trip({ passengers: [] });
    const d = { ...empty, odometerEnd: "1100" };
    expect(codes(closeProblems({ ...d, fuel: [ { liters: "10", amount: "100.000,01", station: "P" } ] }, ok))).toEqual([ "fuel.0.amount_cents" ]);
    expect(codes(closeProblems({ ...d, fuel: Array.from({ length: 21 }, () => ({ liters: "10", amount: "10", station: "P" })) }, ok))).toEqual([ "fuel" ]);
  });
  it("acompanhante também precisa de presença", () => {
    const t = trip({ passengers: [ passenger({ attendance: "boarded", companion: { name: "Joana", document_last4: null }, companion_attendance: "pending" }) ] });
    expect(pendingAttendance(t)).toBe(1);
    expect(codes(closeProblems({ odometerStart: "1", odometerEnd: "2", fuel: [], expenses: [] }, t))).toEqual([ "passengers" ]);
    expect(pendingAttendance(trip({ passengers: [ passenger(), passenger({ id: "p2" }) ] }))).toBe(2);
    expect(pendingAttendance(trip({ passengers: [ passenger({ attendance: "no_show" }) ] }))).toBe(0);
  });
  it("corpo: inteiros, litros em número, centavos e observação em branco omitida", () => {
    const d = { odometerStart: "1000", odometerEnd: "1220", fuel: [ { liters: "40,5", amount: "250,00", station: " Posto Central " } ],
      expenses: [ { kind: "toll", amount: "12,50", note: "" }, { kind: "meal", amount: "30", note: " almoço " } ] };
    expect(closeBody(d)).toEqual({ odometer_start: 1000, odometer_end: 1220, fuel: [ { liters: 40.5, amount_cents: 25000, station: "Posto Central" } ],
      expenses: [ { kind: "toll", amount_cents: 1250 }, { kind: "meal", amount_cents: 3000, note: "almoço" } ] });
    expect(closeBody({ ...d, fuel: [], expenses: [] })).toEqual({ odometer_start: 1000, odometer_end: 1220 });
  });
});

describe("série e rótulos", () => {
  const base = { patientId: "pt2", destinationId: "t1", providerName: "", weekdays: [ 1, 3, 5 ], appointmentTime: "07:00", departureTime: "05:30",
    returnTime: "12:00", boardingLabel: "Praça da Matriz", startsOn: TODAY30, endsOn: "", wheelchair: false, companion: null };
  it("série: dias, horários, fim antes do início", () => {
    expect(seriesProblems(base, TODAY30)).toEqual([]);
    const d = { ...base, weekdays: [], departureTime: "08:00", endsOn: "2026-11-01" };
    expect(codes(seriesProblems(d, TODAY30))).toEqual([ "weekdays", "departure_time", "ends_on" ]);
    expect(weekdaysLabel([ 1, 3, 5 ])).toBe("seg, qua, sex");
    expect(weekdaysLabel([ 7, 2, 6 ])).toBe("ter, sáb, dom");
  });
  it("o api não exige saída antes do atendimento, mas exige retorno depois da saída e rótulo de 3 a 120", () => {
    const d = { ...base, boardingLabel: "ab", returnTime: "05:30", appointmentTime: "" };
    expect(codes(seriesProblems(d, TODAY30))).toEqual([ "boarding_label", "appointment_time", "return_time" ]);
    expect(seriesProblems({ ...base, returnTime: "04:00" }, TODAY30).map((p) => p.text)).toEqual([ "o retorno precisa ser depois da saída" ]);
  });
  it("corpo: dias ordenados, fim e local vazios vão nulos", () => {
    expect(seriesBody({ ...base, weekdays: [ 5, 1, 3, 3 ] })).toEqual({ patient_id: "pt2", destination_id: "t1", provider_name: null, weekdays: [ 1, 3, 5 ],
      appointment_time: "07:00", departure_time: "05:30", return_time: "12:00", boarding_label: "Praça da Matriz", starts_on: TODAY30, ends_on: null,
      wheelchair: false, companion: null });
    expect(seriesBody({ ...base, providerName: " Clínica ", endsOn: "2027-01-01", companion: { name: "Joana Silva", document: "", reason: "" } }))
      .toMatchObject({ provider_name: "Clínica", ends_on: "2027-01-01", companion: { name: "Joana Silva" } });
  });
  it("código desconhecido aparece cru", () => {
    expect(originLabel("regulation")).toBe("regulação");
    expect(originLabel("novo_codigo")).toBe("novo_codigo");
    expect([ "no_seat", "no_wheelchair_spot", "refused" ].map(pendingReasonLabel).every((t) => t.length > 0 && t !== "refused")).toBe(true);
    expect(pendingReasonLabel("novo")).toBe("novo");
  });
});

describe("recusas do api", () => {
  it("todas as recusas, traduzidas", () => {
    const err = refuse(422, { error: "invalid", problems: [ { path: "vehicle_id", error: "vehicle_overlap" }, { path: "driver_id", error: "driver_overlap" } ] });
    expect(transportRefusals(err).map((r) => r.text)).toEqual([
      "o veículo já está em outra viagem nesse horário", "o motorista já está em outra viagem nesse horário"
    ]);
    expect(transportRefusals(err).map((r) => [ r.path, r.code ])).toEqual([ [ "vehicle_id", "vehicle_overlap" ], [ "driver_id", "driver_overlap" ] ]);
  });
  it("cada código que o api manda tem frase própria (nenhum cai no 'recusado pelo servidor')", () => {
    const sent = [ "driver_inactive", "vehicle_required", "driver_required", "trip_day_locked", "stop_not_boarding", "stop_in_use", "trip_not_open",
      "invalid_transition", "trip_not_today", "seats_full", "wheelchair_full", "companion_not_allowed", "origin_required", "origin_mismatch",
      "patient_already_on_trip", "passenger_anonymized", "attendance_pending", "odometer_invalid", "tfd_leg_done", "plate_taken", "renavam_taken",
      "ibge_taken", "user_not_driver", "user_already_driver", "vehicle_overlap", "driver_overlap", "driver_license_expired", "driver_license_category",
      "vehicle_inactive", "return_before_departure", "citizen_not_verified", "person_not_found", "invalid_cpf", "too_many_requests", "not_found",
      "missing_role", "mfa_required", "billing_unit_invalid", "unauthenticated" ];
    for (const code of sent) {
      const text = transportRefusals(refuse(422, { error: code }))[0].text;
      expect(text, code).not.toContain("recusado pelo servidor");
      expect(text, code).not.toContain("não foi possível concluir");
    }
    expect(transportError(refuse(422, { error: "trip_day_locked", path: "date" }))).toBe("a viagem tem passageiro de série ou trecho de TFD — mude só o horário");
    expect(transportError(refuse(409, { error: "plate_taken" }))).toBe("já existe um veículo com esta placa");
  });
  it("sem código no corpo e sem problems: usa a recusa do topo com o caminho", () => {
    const r = transportRefusals(refuse(422, { error: "stop_in_use", path: "stops" }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ path: "stops", code: "stop_in_use", text: "esta parada tem passageiro — mude o passageiro de parada antes" });
  });
  it("invalid_request fala do campo pelo caminho pontuado", () => {
    const t = (path: string) => transportError(refuse(422, { error: "invalid_request", path }));
    expect(t("fuel.0.liters")).toContain("abastecimento");
    expect(t("expenses.1.kind")).toContain("despesa");
    expect(t("companion.name")).toContain("acompanhante");
    expect(t("stops.2.label")).toContain("parada");
    expect(t("reason")).toContain("motivo");
    expect(t("qualquer")).toBe("pedido inválido — recarregue a tela e tente de novo");
  });
  it("C5: só `reason` (ou `.reason`) é o motivo; `exception_reason` não; `items.N` não fala em destacado", () => {
    const t = (path: string) => transportError(refuse(422, { error: "invalid_request", path }));
    expect(t("reason")).toBe(REASON_TEXT);
    expect(t("companion.reason")).toContain("acompanhante");
    expect(t("series.reason")).toBe(REASON_TEXT);
    expect(t("exception_reason")).not.toBe(REASON_TEXT);
    expect(t("items.0.attendance")).not.toContain("destacad");
    expect(t("items.0.attendance")).toContain("presença");
  });
  it("C9: refusalTexts junta todas sem repetir; recusa local vai como está; motivo e códigos de releitura num lugar só", () => {
    const err = refuse(422, { error: "x", problems: [ { path: "a", error: "not_found" }, { path: "b", error: "trip_not_open" }, { path: "c", error: "not_found" } ] });
    expect(refusalTexts(err)).toBe(`${transportRefusals(err)[0].text}; ${transportRefusals(err)[1].text}`);
    expect(refusalTexts(new LocalRefusal("frase local"))).toBe("frase local");
    expect([ reasonProblemText("curto"), reasonProblemText("motivo com tamanho bom"), reasonProblemText("x".repeat(501)) ]).toEqual([ REASON_TEXT, null, REASON_TEXT ]);
    for (const code of [ "not_found", "trip_not_open", "invalid_transition", "passenger_anonymized" ]) expect(isStaleRefusal(refuse(422, { error: code })), code).toBe(true);
    expect(isStaleRefusal(refuse(422, { error: "seats_full" }))).toBe(false);
  });
  it("feature_disabled e código desconhecido", () => {
    expect(transportRefusals(refuse(403, { error: "feature_disabled", feature: "sanitary_transport" }))[0].text).toBe("o transporte sanitário está desligado nesta cidade");
    expect(transportRefusals(refuse(403, { error: "feature_disabled", feature: "tfd" }))[0].text).toBe("Tratamento Fora de Domicílio (TFD) está desligado nesta cidade");
    expect(transportRefusals(refuse(422, { error: "novo_erro" }))[0].text).toBe("recusado pelo servidor (novo_erro)");
    // Código que só a farmácia conhece não empresta a frase dela.
    expect(transportRefusals(refuse(422, { error: "expired_lot" }))[0].text).toBe("recusado pelo servidor (expired_lot)");
  });
  it("erro que não é do api (rede)", () => {
    expect(transportError(new Error("x"))).toBe("sem conexão com o servidor — tente de novo");
  });
});
