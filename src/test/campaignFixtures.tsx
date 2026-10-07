// src/test/campaignFixtures.tsx
// Dados e harness comuns aos testes do módulo 12. Cada arquivo de teste faz o
// próprio vi.mock("…/lib/api"); este módulo importa só tipos e o AuthProvider,
// que passa a usar a versão mockada do api do arquivo que o importou.
import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../lib/auth";
import type { Audience, Campaign, CampaignOptions, SessionUser } from "../lib/api";

export const OPTIONS: CampaignOptions = {
  protocols: [ "Dor torácica", "Febre" ],
  tiers: [ "vermelha", "amarela" ],
  outcomes: [ "discharged", "referred", "return", "left", "scheduled_from_screening", "oriented" ],
  neighborhoods: [ { id: "n1", name: "Boqueirão" }, { id: "n2", name: "Xaxim" }, { id: "n3", name: "Centro" } ],
  units: [ { id: "u1", name: "UBS Centro" }, { id: "u2", name: "UPA Boqueirão" } ]
};

export const CITY_AUDIENCE: Audience = { version: 1, geo: { scope: "city" }, clinical: { all: [] } };

export function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "c1", title: "Vacinação contra a gripe", status: "draft", send_at: null, dispatched_at: null,
    recipients_count: null, body: "Vacinação no sábado, das 8h às 17h, na sua UBS.", audience: CITY_AUDIENCE,
    failure_reason: null, sms_enabled: null, phones_count: null, created_at: "2026-09-28T10:00:00-03:00", stats: null,
    ...overrides
  };
}

// `mfa_verified_at` = agora: a janela de step-up está aberta. Passe
// `{ mfa_verified_at: null }` para forçar o pedido do código.
export function sessionWith(roles: string[], overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u-1", email_address: "campanhas@curitiba.demo", operator: false,
    memberships: roles.map((role) => ({ city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role })),
    mfa_enrolled: true, mfa_verified_at: new Date().toISOString(), ...overrides
  };
}

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  return { client, ...render(ui, { wrapper }) };
}
