// Dados dos testes do módulo 33 (ouvidoria). Agora: quarta, 2026-11-11, 10h. Formas do api real (api-shapes.md §2), não as
// do plano: `options` com `health_units`, assuntos em árvore e `professionals`; detalhe com `can`, sem `cycle_started_on`;
// `text` do evento e `reply`/`replied_*` do encaminhamento só quando existem; anexo só `{ id, uploaded_by }`; painel com
// partições em objeto e `total`; relatório sem `published_by`.
import type {
  ManifestationState, OmbudsmanAnnualReport, OmbudsmanCan, OmbudsmanDashboard, OmbudsmanEvent, OmbudsmanForwarding,
  OmbudsmanFullIdentity, OmbudsmanInboxItem, OmbudsmanListItem, OmbudsmanManifestation, OmbudsmanOptions, OmbudsmanPage,
  OmbudsmanReceipt, OmbudsmanSettings, OmbudsmanSubject, SessionUser
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const NOW33 = new Date("2026-11-11T10:00:00-03:00");
export const TODAY33 = "2026-11-11";
export const ombudsmanUser = (roles: string[], features: string[] = [ "ombudsman" ]): SessionUser => sessionWith(roles, { features });

const HIDDEN = { suppressed: true } as const;

export const UNITS33: OmbudsmanOptions["health_units"] = [
  { id: "ubs1", name: "UBS Centro", kind: "ubs", has_active_responder: true },
  { id: "upa1", name: "UPA Boqueirão", kind: "upa", has_active_responder: false }
];
export const DEPARTMENTS33: OmbudsmanOptions["departments"] = [
  { id: "dep1", name: "Assistência Farmacêutica", has_active_responder: true },
  { id: "dep2", name: "Regulação", has_active_responder: false }
];
// Assuntos de `options`: só ativos, em árvore de dois níveis.
export const SUBJECTS33: OmbudsmanOptions["subjects"] = [
  { id: "s1", name: "Atendimento", children: [ { id: "s11", name: "Demora" }, { id: "s12", name: "Conduta de profissional" } ] },
  { id: "s6", name: "Transporte", children: [] }
];
export const PROFESSIONALS33: OmbudsmanOptions["professionals"] = [
  { id: "p1", name: "Carlos Mendes", health_unit_ids: [ "ubs1" ] },
  { id: "p2", name: "Beatriz Rocha", health_unit_ids: [ "ubs1", "upa1" ] }
];
export const options = (o: Partial<OmbudsmanOptions> = {}): OmbudsmanOptions =>
  ({ subjects: SUBJECTS33, departments: DEPARTMENTS33, health_units: UNITS33, professionals: PROFESSIONALS33, ...o });
// Assuntos de `GET /ombudsman/subjects` (configuração): árvore com os inativos.
export const subjects33 = (): OmbudsmanSubject[] => [
  { id: "s1", name: "Atendimento", active: true, children: [
    { id: "s11", name: "Demora", active: true }, { id: "s12", name: "Conduta de profissional", active: true },
    { id: "s13", name: "Fila antiga", active: false }
  ] },
  { id: "s6", name: "Transporte", active: true, children: [] },
  { id: "s9", name: "Antigo", active: false, children: [] }
];

export const listItem = (o: Partial<OmbudsmanListItem> = {}): OmbudsmanListItem => ({
  id: "m1", protocol: "2026-000123", kind: "complaint", identification_mode: "identified", channel: "web", state: "in_analysis",
  subject: { id: "s11", name: "Demora", parent: { id: "s1", name: "Atendimento" } }, health_unit: { id: "ubs1", name: "UBS Centro" },
  urgent: false, received_at: "2026-11-03T09:12:00-03:00", due_on: "2026-12-03", color: "green", pending_forwardings: 0, ...o
});
export const page = (o: Partial<OmbudsmanPage> = {}): OmbudsmanPage => ({ items: [ listItem() ], next_before: null, ...o });

export const event = (o: Partial<OmbudsmanEvent> = {}): OmbudsmanEvent => ({
  id: "e1", kind: "received", actor: "citizen", actor_name: null, at: "2026-11-03T09:12:00-03:00", data: {}, visible_to_citizen: true, ...o
});
export const forwarding = (o: Partial<OmbudsmanForwarding> = {}): OmbudsmanForwarding => ({
  id: "f1", destination: { kind: "department", id: "dep1", name: "Assistência Farmacêutica" },
  extract: "Usuária relata falta de losartana na farmácia da UBS Centro há duas semanas.", state: "pending", due_on: "2026-11-25",
  color: "green", extended: false, created_at: "2026-11-05T14:00:00-03:00", ...o
});

// O `can` do api (json.rb:59-81) para quem lê: ouvidor (`lead`, o padrão) ou só técnico.
const OPEN: ManifestationState[] = [ "received", "in_analysis", "forwarded", "awaiting_complement" ];
export function can33(m: Omit<OmbudsmanManifestation, "can">, lead = true): OmbudsmanCan {
  const s = m.state;
  const pending = m.pending_forwardings;
  const anonymous = m.identification_mode === "anonymous";
  return {
    classify: s === "received" || s === "in_analysis",
    forward: s === "in_analysis" || s === "forwarded",
    cancel_forwarding: pending > 0,
    request_complement: s === "in_analysis" && !m.complement_used && !anonymous,
    complement: s === "awaiting_complement",
    extend: lead && [ "in_analysis", "forwarded", "awaiting_complement" ].includes(s) && !m.extended,
    interim_response: OPEN.includes(s) && !anonymous,
    final_response: s === "in_analysis" && pending === 0,
    archive: lead && [ "received", "in_analysis", "awaiting_complement" ].includes(s),
    reopen: lead && (s === "answered" || s === "archived"),
    change_resolution: lead && s === "answered" && [ "complaint", "request", "report" ].includes(m.kind),
    decide_reopen: lead && m.reopen_request !== null,
    open_identity: lead && m.identity_available,
    record_identity_consent: lead && m.identity_available
  };
}

// Detalhe visto pelo ouvidor; `can` segue o estado (passe `can` para outro leitor, ex.: `can33(m, false)`).
export const manifestation = (o: Partial<OmbudsmanManifestation> = {}): OmbudsmanManifestation => {
  const m: Omit<OmbudsmanManifestation, "can"> = {
    ...listItem(), ouvidorsus_number: null,
    body: "Fui à UBS Centro três vezes e não havia losartana. Preciso do remédio para a pressão.",
    identity: { name: "Maria Lima", cpf_masked: "***.***.***-25", phone_masked: "(41) *****-1234" }, identity_available: true,
    referred_professional: null, cycle: 1, extended: false, extension_reason: null, complement_used: false,
    complement_requested_at: null, complement_due_on: null, resolution: null, archive_reason: null, duplicate_of: null,
    external_body_name: null, concluded_at: null,
    events: [ event(), event({ id: "e2", kind: "classified", actor: "staff", actor_name: "Ana Souza", at: "2026-11-04T08:30:00-03:00",
      visible_to_citizen: false }) ],
    forwardings: [], attachments: [], reopen_request: null, ...o
  };
  return { ...m, can: o.can ?? can33(m) };
};
// Denúncia com identidade preservada: o detalhe traz só a string "preserved".
export const preserved = (o: Partial<OmbudsmanManifestation> = {}): OmbudsmanManifestation =>
  manifestation({ id: "m2", protocol: "2026-000124", kind: "report", identification_mode: "preserved", identity: "preserved", ...o });

export const fullIdentity = (o: Partial<OmbudsmanFullIdentity> = {}): OmbudsmanFullIdentity => ({
  name: "Joana Prado", full_name: "Joana Prado Lima", cpf: "529.982.247-25", phone: "(41) 99876-1234",
  manifestant_name: null, manifestant_contact: null, manifestant_cpf: null, ...o
});
export const inboxItem = (o: Partial<OmbudsmanInboxItem> = {}): OmbudsmanInboxItem => ({
  id: "f1", destination: { kind: "department", id: "dep1", name: "Assistência Farmacêutica" },
  extract: "Usuária relata falta de losartana na farmácia da UBS Centro há duas semanas.", due_on: "2026-11-25", color: "green",
  state: "pending", created_at: "2026-11-05T14:00:00-03:00", extended: false, ...o
});
export const settings33 = (o: Partial<OmbudsmanSettings> = {}): OmbudsmanSettings => ({
  response_days: 30, extension_days: 30, urgent_days: 15, complement_days: 20, forwarding_days: 20, forwarding_extension_days: 20,
  warning_days: 5, anonymous_daily_cap: 50, ...o
});
export const receipt = (o: Partial<OmbudsmanReceipt> = {}): OmbudsmanReceipt =>
  ({ protocol: "2026-000130", kind: "complaint", received_at: "2026-11-11T09:58:00-03:00", due_on: "2026-12-11", channel: "in_person", ...o });

// Painel (api-shapes §2.7), coerente com a supressão Q53/Q54: em `by_kind` três células escondidas (2 + 3 + 0, o zero
// também), em `satisfaction.met` duas (3 + 2); o resto à mostra.
export const dashboard33 = (o: Partial<OmbudsmanDashboard> = {}): OmbudsmanDashboard => ({
  period: { from: "2026-11-01", to: "2026-11-11" }, total: 42,
  by_kind: { complaint: 30, report: 7, praise: HIDDEN, suggestion: HIDDEN, request: HIDDEN, total: 42 },
  by_channel: { web: 28, in_person: 6, phone: 8, ouvidorsus: 0, total: 42 },
  by_state: { received: 5, in_analysis: 10, forwarded: 7, awaiting_complement: 0, answered: 15, archived: 5, total: 42 },
  by_subject: [ { id: "s1", name: "Atendimento", count: 18 }, { id: "s6", name: "Transporte", count: 9 },
    { id: null, name: null, unclassified: true, count: 15 } ],
  by_health_unit: [ { id: "ubs1", name: "UBS Centro", count: 12 }, { id: "upa1", name: "UPA Boqueirão", count: 8 } ],
  on_time_rate: 85.0, avg_days_to_conclude: 17.4, resolution_rate: 60.0,
  satisfaction: { responses: 12, met: { yes: 7, partly: HIDDEN, no: HIDDEN }, clear: { yes: 12, no: 0 }, avg_score: 4.1 },
  ...o
});
// Rascunho do ano anterior (o publicável, Q27), sem linha gravada: textos nulos.
export const annualReport = (o: Partial<OmbudsmanAnnualReport> = {}): OmbudsmanAnnualReport => ({
  year: 2025, state: "draft", recurring_problems: null, actions_taken: null, notes: null,
  numbers: dashboard33({ period: { from: "2025-01-01", to: "2025-12-31" } }), published_at: null, ...o
});
