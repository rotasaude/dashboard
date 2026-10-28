// RegulationOffers — prestadores, ofertas e cotas mensais com saldo (módulo 26a; F-26.4; contrato §6).
// O municipal_admin cria e edita (toda escrita passa pelo step-up, nos formulários); o care_regulator só lê. A oferta traz
// `used` e `available` calculados pelo api: a tela não recalcula saldo. Só a oferta do mês corrente (fuso da cidade) é
// autorizável, então o mês padrão é o corrente; os meses seguintes ficam preparados e os passados, só para consulta.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAllUnits, listCareOffers, listCareProviders } from "../lib/api";
import type { CareOffer, CareProvider } from "../lib/api";
import { REG_OFFERS_KEY, REG_PROVIDERS_KEY, STATIC_QUERY, currentMonth, monthLabel, providerKindLabel, regulationError, typeLabel } from "../lib/regulation";
import { cityIsoDate } from "../lib/format";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { RegulationGate } from "./regulation/RegulationGate";
import { ProviderForm } from "./regulation/ProviderForm";
import { OfferForm } from "./regulation/OfferForm";
import { statusStyle } from "./regulation/styles";

export function RegulationOffers({ today, onGoToSecurity }: { today?: string; onGoToSecurity?(): void } = {}) {
  return (
    <RegulationGate title="Prestadores e cotas" sub="prestadores, ofertas e cota mensal com saldo" allow={(r) => r.regulator || r.admin}>
      {(roles) => <Body today={today} canWrite={roles.admin} onGoToSecurity={onGoToSecurity} />}
    </RegulationGate>
  );
}

const UNITS_KEY = "regulationUnits";
const stackCell: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const mutedText: CSSProperties = { fontSize: 11, color: "var(--ink3)" };

type ProviderEditor = CareProvider | "new" | null;
type OfferEditor = CareOffer | "new" | null;

export function soldOutText(n: number): string {
  return `${n} ${n === 1 ? "oferta esgotada" : "ofertas esgotadas"} neste mês`;
}

function Body({ today, canWrite, onGoToSecurity }: { today?: string; canWrite: boolean; onGoToSecurity?(): void }) {
  const day = today ?? cityIsoDate();
  const queryClient = useQueryClient();
  const [ month, setMonth ] = useState(currentMonth(day));
  const providers = useQuery({ queryKey: [ REG_PROVIDERS_KEY ], queryFn: listCareProviders, ...STATIC_QUERY });
  const offers = useQuery({ queryKey: [ REG_OFFERS_KEY, month, "all" ], queryFn: () => listCareOffers({ month }), ...STATIC_QUERY });
  // As unidades só servem ao formulário do prestador da rede própria: quem só lê não as pede.
  const units = useQuery({ queryKey: [ UNITS_KEY ], queryFn: listAllUnits, enabled: canWrite, ...STATIC_QUERY });
  const [ providerEditor, setProviderEditor ] = useState<ProviderEditor>(null);
  const [ offerEditor, setOfferEditor ] = useState<OfferEditor>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  const openProvider = (next: ProviderEditor) => { setNotice(null); setOfferEditor(null); setProviderEditor(next); };
  const openOffer = (next: OfferEditor) => { setNotice(null); setProviderEditor(null); setOfferEditor(next); };
  // O nome do prestador aparece nas ofertas: as duas leituras se refazem.
  function saved(message: string) {
    setProviderEditor(null); setOfferEditor(null); setNotice(message);
    void queryClient.invalidateQueries({ queryKey: [ REG_PROVIDERS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ REG_OFFERS_KEY ] });
  }

  const soldOut = (offers.data ?? []).filter((o) => o.available <= 0).length;

  return (
    <div style={stack}>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      <Panel title="Prestadores" sub="rede própria, contratados, consórcios e PPI"
        right={canWrite ? <button type="button" style={secondaryButtonStyle} onClick={() => openProvider("new")}>Novo prestador</button> : undefined}>
        <div style={stack}>
          {providers.isPending && <p className="mono" style={muted}>carregando…</p>}
          {providers.isError && <p role="alert" style={alert}>{regulationError(providers.error)}</p>}
          {providers.data && (
            <DataTable<CareProvider>
              cols={[
                { label: "Prestador", w: "2fr", card: "title", render: (p) => p.name },
                { label: "CNES", w: "1fr", render: (p) => <span className="mono">{p.cnes || "—"}</span> },
                { label: "Tipo", w: "1fr", render: (p) => providerKindLabel(p.kind) },
                { label: "Unidade da rede", w: "1.6fr", render: (p) => p.health_unit?.name ?? "—" },
                { label: "Situação", w: "90px", render: (p) => <Tag tone={p.active ? "ok" : "neutral"}>{p.active ? "ativo" : "inativo"}</Tag> },
                ...(canWrite ? [ {
                  label: "Ação", w: "90px", card: "actions" as const,
                  render: (p: CareProvider) => <button type="button" style={secondaryButtonStyle} onClick={() => openProvider(p)}>Editar</button>
                } ] : [])
              ]}
              rows={providers.data} rowKey={(p) => p.id} empty="nenhum prestador cadastrado"
            />
          )}
        </div>
      </Panel>
      {providerEditor && (
        <ProviderForm key={providerEditor === "new" ? "new" : providerEditor.id} provider={providerEditor === "new" ? null : providerEditor}
          units={units.data ?? []} onSaved={saved} onCancel={() => setProviderEditor(null)} onGoToSecurity={onGoToSecurity} />
      )}
      <Panel title={`Ofertas e cotas de ${monthLabel(month)}`} sub="quantidade, autorizadas e saldo por prestador e alvo"
        right={canWrite ? <button type="button" style={secondaryButtonStyle} onClick={() => openOffer("new")}>Nova oferta</button> : undefined}>
        <div style={stack}>
          <label style={{ ...fieldLabel, maxWidth: 220 }}>
            Ver o mês
            <input type="month" value={month} style={inputStyle}
              onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }} />
          </label>
          {soldOut > 0 && <p role="status" style={statusStyle}>{soldOutText(soldOut)}</p>}
          {offers.isPending && <p className="mono" style={muted}>carregando…</p>}
          {offers.isError && <p role="alert" style={alert}>{regulationError(offers.error)}</p>}
          {offers.data && (
            <DataTable<CareOffer>
              cols={[
                {
                  label: "Prestador", w: "1.6fr", card: "title", render: (o) => (
                    <span style={stackCell}>
                      <strong>{o.provider.name}</strong>
                      <span className="mono" style={mutedText}>{providerKindLabel(o.provider.kind)}</span>
                    </span>
                  )
                },
                {
                  label: "Alvo", w: "1.6fr", render: (o) => (
                    <span style={stackCell}>
                      <span>{o.target.name}</span>
                      <span className="mono" style={mutedText}>{typeLabel(o.target.type)}</span>
                    </span>
                  )
                },
                { label: "Quantidade", w: "0.9fr", render: (o) => String(o.quantity) },
                { label: "Usadas", w: "0.8fr", render: (o) => String(o.used) },
                {
                  label: "Saldo", w: "1fr", render: (o) => (
                    <span style={rowInline}>
                      <span>{String(o.available)}</span>
                      {o.available <= 0 && <Tag tone="down">esgotada</Tag>}
                    </span>
                  )
                },
                ...(canWrite ? [ {
                  label: "Ação", w: "1.2fr", card: "actions" as const,
                  render: (o: CareOffer) => <button type="button" style={secondaryButtonStyle} onClick={() => openOffer(o)}>Mudar quantidade</button>
                } ] : [])
              ]}
              rows={offers.data} rowKey={(o) => o.id} empty="nenhuma oferta neste mês"
            />
          )}
        </div>
      </Panel>
      {offerEditor && (
        <OfferForm key={offerEditor === "new" ? "new" : offerEditor.id} offer={offerEditor === "new" ? null : offerEditor}
          providers={providers.data ?? []} today={day} onSaved={saved} onCancel={() => setOfferEditor(null)} onGoToSecurity={onGoToSecurity} />
      )}
    </div>
  );
}

const rowInline: CSSProperties = { ...row, gap: 6 };
