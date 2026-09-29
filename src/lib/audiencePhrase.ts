// src/lib/audiencePhrase.ts
// O público em português (spec 2026-09-29 §7): no modal de envio e no painel
// da campanha. Os nomes vêm de GET /campaigns/options (bairros e unidades
// ATIVOS); id que não está lá é nomeado como inativo, nunca some da frase.
import type { Audience, AudienceGeo, Criterion, CriterionPeriod, NamedRef } from "./api";
import { OUTCOME_LABEL, REQUEST_KIND_LABEL } from "./campaigns";

export interface PhraseLookup { neighborhoods: NamedRef[]; units: NamedRef[] }

// "YYYY-MM-DD" → "DD/MM/AAAA" por texto: new Date("2026-07-01") seria meia-noite
// UTC, que em São Paulo ainda é 30/06.
export function fmtDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

export function joinPt(items: string[], last = "e"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

function nameOf(list: NamedRef[], id: string, fallback: string): string {
  return list.find((x) => x.id === id)?.name ?? fallback;
}

function period(p: CriterionPeriod): string {
  return p.from === p.to ? `em ${fmtDay(p.from)}` : `entre ${fmtDay(p.from)} e ${fmtDay(p.to)}`;
}

function geoPhrase(geo: AudienceGeo, lookup: PhraseLookup): string {
  switch (geo.scope) {
    case "city": return "cidadãos de toda a cidade";
    case "unit": return `moradores da área de cobertura de ${nameOf(lookup.units, geo.health_unit_id, "(unidade inativa)")}`;
    case "neighborhoods":
      return `moradores de ${joinPt(geo.neighborhood_ids.map((id) => nameOf(lookup.neighborhoods, id, "(bairro inativo)")))}`;
  }
}

function criterionPhrase(c: Criterion, lookup: PhraseLookup): string {
  const unit = (id: string) => nameOf(lookup.units, id, "(unidade inativa)");
  switch (c.kind) {
    case "protocol_period":
      return `fizeram triagem concluída pelo protocolo ${c.protocol_name} ${period(c)}`;
    case "triage_tier":
      return `tiveram triagem concluída na faixa ${joinPt(c.tiers, "ou")} ${period(c)}`;
    case "triage_incomplete":
      return `deixaram uma triagem sem concluir ${period(c)}`;
    case "attendance_outcome": {
      const outcomes = joinPt(c.outcomes.map((o) => OUTCOME_LABEL[o] ?? o), "ou");
      return `tiveram atendimento encerrado como ${outcomes}${c.health_unit_id ? ` em ${unit(c.health_unit_id)}` : ""} ${period(c)}`;
    }
    case "triaged_not_attended":
      return `fizeram triagem concluída ${period(c)} e não foram atendidos depois dela`;
    case "appointment_no_show":
      return `faltaram a um agendamento ${period(c)}`;
    case "appointment_request_open": {
      const kinds = c.kinds && c.kinds.length > 0 ? ` de ${joinPt(c.kinds.map((k) => REQUEST_KIND_LABEL[k] ?? k), "ou")}` : "";
      return `têm pedido de agendamento${kinds} aberto${c.target_unit_id ? ` para ${unit(c.target_unit_id)}` : ""}`;
    }
  }
}

export function describeAudience(audience: Audience, lookup: PhraseLookup): string {
  const geo = geoPhrase(audience.geo, lookup);
  const criteria = audience.clinical.all.map((c) => criterionPhrase(c, lookup));
  return criteria.length === 0 ? geo : `${geo} que ${criteria.join(" e também ")}`;
}
