// src/modules/vectorControl/InstallForm.tsx
// Instalação da ovitrampa pelo agente de endemias (módulo 35a, F-35.5; contrato §6, §17; Q7(5), Q7(6), Q23). O domicílio sai da
// lista do 24a da microárea (`listVisitHouseholds`, nominal, "Carregar mais"; só o endereço curto, nunca o responsável) e, escolhido,
// o perfil vetorial (`getHouseholdVectorProfile`) diz se há quarteirão: sem ele, a frase `household_without_block` e o envio
// desabilitado. `installProblems` na ordem do api (número, data, quarteirão, termo). POST /vector_control/ovitraps com o
// client_uuid do 24b (`useIdempotentSubmit`): o mesmo no reenvio depois de rede/5xx, trocado depois de gravar ou de um 4xx.
// `ovitrap_number_taken` é 422 path number (Q23): a frase vai ao campo "Número".
import { useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getHouseholdVectorProfile, installOvitrap, listVisitHouseholds, type Ovitrap, type OvitrapInstallInput, type VisitHousehold
} from "../../lib/api";
import { HV_HOUSEHOLDS_KEY, NOMINAL_QUERY, STATIC_QUERY } from "../../lib/homeVisits";
import { VC_PROFILE_KEY, installProblems, vectorError, vectorRefusals } from "../../lib/vectorControl";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import type { Problem } from "../../lib/pharmacy";
import { useIdempotentSubmit } from "../homeVisits/useIdempotentSubmit";
import { ConfirmButton } from "../../components/ConfirmButton";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

export const INSTALL_NETWORK_RETRY = "não foi possível confirmar a instalação — tente de novo: a mesma ovitrampa não é instalada duas vezes";
export const DISCARD_UNCERTAIN_INSTALL = "a ovitrampa pode já ter sido instalada — ao descartar, a lista é relida; confira antes de instalar de novo";
export const TCLE_LABEL = "O morador assinou o termo de consentimento (TCLE)";
const PICK_HOUSEHOLD = "escolha o domicílio";
const OWN = [ "household_id", "number", "installed_on", "consent" ];

type Picked = Pick<VisitHousehold, "id" | "address_short">;

// `onCancel(uncertain)`: true quando se descartou um envio pendurado (o pai relê a lista uma vez).
export function InstallForm({ microAreaId, today, onDone, onCancel }: {
  microAreaId: string; today: string; onDone(o: Ovitrap): void; onCancel(uncertain: boolean): void;
}) {
  const s = useIdempotentSubmit({ networkText: INSTALL_NETWORK_RETRY });
  const [ picked, setPicked ] = useState<Picked | null>(null);
  const [ number, setNumber ] = useState("");
  const [ installedOn, setInstalledOn ] = useState(today);
  const [ consent, setConsent ] = useState(false);
  const profile = useQuery({
    queryKey: [ VC_PROFILE_KEY, picked?.id ], queryFn: () => getHouseholdVectorProfile(picked!.id), enabled: !!picked, ...STATIC_QUERY
  });
  const hasBlock = profile.data ? !!profile.data.vector?.city_block_id : null;
  const frozen = s.locked || s.busy;
  const blocked = frozen || hasBlock === false || (!!picked && profile.isPending);

  function submit(ev: FormEvent) {
    if (blocked && !frozen) { ev.preventDefault(); return; }
    void s.send<Omit<OvitrapInstallInput, "client_uuid">, Ovitrap>(ev, {
      check: (): Problem[] => [
        ...(picked ? [] : [ { path: "household_id", text: PICK_HOUSEHOLD } ]),
        ...installProblems({ number, consent, installedOn, householdHasBlock: hasBlock }, today)
      ],
      body: () => ({ household_id: picked!.id, number, consent: true, installed_on: installedOn }),
      call: (input) => installOvitrap(input),
      ok: onDone,
      refused: (_r, err) => vectorRefusals(err).map((r) => ({ path: r.path, text: r.text }))
    });
  }

  return (
    <form ref={s.formRef} noValidate style={form} aria-label="Instalar ovitrampa" onSubmit={submit}>
      <p ref={s.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Instalar ovitrampa</p>

      <fieldset style={fieldset} {...s.aria("household_id")}>
        <legend style={legend}>Domicílio</legend>
        {picked && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, overflowWrap: "anywhere" }}>{picked.address_short}</span>
            {profile.isPending && <span role="status" style={muted}>Carregando o perfil do imóvel…</span>}
            {profile.isError && <p role="alert" style={alert}>{vectorError(profile.error)}</p>}
            {hasBlock === false && <p role="alert" style={alert}>{VECTOR_ERRORS.household_without_block}</p>}
            <div>
              <button type="button" disabled={frozen} style={secondaryButtonStyle} onClick={() => { setPicked(null); s.clear("household_id"); }}>
                Trocar domicílio
              </button>
            </div>
          </div>
        )}
        {/* A lista do 24a grava trilha e é nominal (gcTime 0): fica montada e escondida com o domicílio escolhido, para "Trocar
            domicílio" não ler de novo (nem perder as páginas carregadas). */}
        <div style={{ display: picked ? "none" : "block" }}>
          <HouseholdList microAreaId={microAreaId} disabled={frozen} onPick={(h) => { setPicked(h); s.clear("household_id"); }} />
        </div>
      </fieldset>
      {s.errNode("household_id")}

      <label style={fieldLabel}>
        Número
        <input value={number} disabled={frozen} maxLength={12} autoComplete="off" style={inputStyle} {...s.aria("number")}
          onChange={(e) => { setNumber(e.target.value); s.clear("number"); }} />
      </label>
      {s.errNode("number")}

      <label style={fieldLabel}>
        Data da instalação
        <input type="date" value={installedOn} max={today} disabled={frozen} style={inputStyle} {...s.aria("installed_on")}
          onChange={(e) => { setInstalledOn(e.target.value); s.clear("installed_on"); }} />
      </label>
      {s.errNode("installed_on")}

      <label style={checkLabel}>
        <input type="checkbox" checked={consent} disabled={frozen} {...s.aria("consent")}
          onChange={(e) => { setConsent(e.target.checked); s.clear("consent"); }} />
        {TCLE_LABEL}
      </label>
      {s.errNode("consent")}

      {s.top((p) => OWN.includes(p))}
      {s.locked ? (
        <div style={row}>
          <button type="button" aria-disabled={s.busy || undefined} style={s.busy ? disabledButtonStyle : buttonStyle}
            onClick={() => { if (!s.busy) void s.retry(); }}>Tentar de novo</button>
          {s.busy
            ? <button type="button" aria-disabled style={disabledButtonStyle}>Descartar</button>
            : <ConfirmButton label="Descartar" question={DISCARD_UNCERTAIN_INSTALL} onConfirm={() => onCancel(true)} />}
        </div>
      ) : (
        <div style={row}>
          <button type="submit" aria-disabled={blocked || undefined} style={blocked ? disabledButtonStyle : buttonStyle}>Instalar</button>
          <button type="button" aria-disabled={s.busy || undefined} style={s.busy ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { if (!s.busy) onCancel(false); }}>Cancelar</button>
        </div>
      )}
    </form>
  );
}

// Os domicílios da microárea, pelo endereço curto (a lista do 24a traz o responsável da família: nunca aparece aqui).
function HouseholdList({ microAreaId, disabled, onPick }: { microAreaId: string; disabled: boolean; onPick(h: Picked): void }) {
  const pages = useInfiniteQuery({
    queryKey: [ HV_HOUSEHOLDS_KEY, microAreaId ],
    queryFn: ({ pageParam }) => listVisitHouseholds(microAreaId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  if (!pages.data) return pages.isError ? <p role="alert" style={alert}>{vectorError(pages.error)}</p> : <p role="status" style={muted}>Carregando domicílios…</p>;
  const items = pages.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <p style={muted}>Nenhum domicílio cadastrado nesta microárea.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((h) => (
          <li key={h.id} style={row}>
            <button type="button" disabled={disabled || h.status !== "active"} style={{ ...secondaryButtonStyle, textAlign: "left", overflowWrap: "anywhere" }}
              onClick={() => onPick({ id: h.id, address_short: h.address_short })}>
              {h.address_short}
            </button>
            {h.status !== "active" && <span style={muted}>domicílio inativo</span>}
          </li>
        ))}
      </ul>
      {pages.hasNextPage && (
        <div>
          <button type="button" disabled={disabled || pages.isFetchingNextPage} style={secondaryButtonStyle} onClick={() => void pages.fetchNextPage()}>
            Carregar mais
          </button>
        </div>
      )}
      {pages.isError && <p role="alert" style={alert}>{vectorError(pages.error)}</p>}
    </div>
  );
}
