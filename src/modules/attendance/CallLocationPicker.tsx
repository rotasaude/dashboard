// Local da chamada (módulo 32a, F-32.5; contrato §6, §14 Q7; D6). Só com `waiting_room_display` (quem monta passa `enabled`): a lista
// vem de `GET /attendance/call_locations?health_unit_id` (só os ativos viram escolha) e traz `location_required` (TV ativa na unidade).
// A escolha fica lembrada na sessão do navegador por usuário e unidade (readCallLocation/writeCallLocation); um id lembrado que saiu da
// lista (local desativado) conta como nenhum. Dois seletores da mesma unidade na tela (a mesa da UPA e o painel de antes da urgência)
// andam juntos. Usado pela mesa da UPA e pela fila do 13 (UBS).
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorCode, listCallLocations, type CallLocation } from "../../lib/api";
import { CALL_LOCATIONS_KEY, URGENCY_ERRORS, callLocationKey, readCallLocation, urgencyError, writeCallLocation } from "../../lib/urgency";
import { inputStyle } from "../../components/formStyles";

export const NO_LOCATIONS_TEXT = "cadastre os locais de chamada em Urgência → Senhas, locais e TVs";

export interface CallLocationState {
  enabled: boolean;
  // A lista ainda não chegou.
  loading: boolean;
  locations: CallLocation[];
  // Enquanto a lista carrega, conta como obrigatório: não sai chamada que o api recusaria.
  required: boolean;
  selected: string | null;
  select(id: string | null): void;
  problem: string | null;
  setProblem(p: string | null): void;
  selectRef: RefObject<HTMLSelectElement>;
  // A chamada pode sair? Obrigatório e sem escolha: a frase sob o seletor e o foco nele.
  ready(): boolean;
  // Recusa do api sobre o local (call_location_required, invalid_call_location): a frase e o foco; o local recusado é esquecido e a
  // lista relida. Devolve true quando tratou.
  refused(err: unknown): boolean;
  nameOf(id: string | null): string | null;
}

// Os seletores montados, por chave de usuário e unidade, para andarem juntos (o storage não avisa a própria aba).
const listeners = new Set<(key: string, id: string | null) => void>();

export function useCallLocation(userId: string, unitId: string, enabled: boolean): CallLocationState {
  const key = callLocationKey(userId, unitId);
  const query = useQuery({ queryKey: [ CALL_LOCATIONS_KEY, unitId ], queryFn: () => listCallLocations(unitId), enabled });
  const [ mem, setMem ] = useState<{ key: string; id: string | null }>(() => ({ key, id: readCallLocation(userId, unitId) }));
  const [ problem, setProblem ] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const onChange = (k: string, id: string | null) => { if (k === key) setMem({ key, id }); };
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
  }, [ key ]);

  const stored = mem.key === key ? mem.id : readCallLocation(userId, unitId);
  const locations = enabled ? (query.data?.items ?? []).filter((l) => l.active) : [];
  const selected = stored !== null && locations.some((l) => l.id === stored) ? stored : null;
  const required = enabled && (query.data ? query.data.location_required : query.isPending);

  const select = (id: string | null) => {
    writeCallLocation(userId, unitId, id);
    setProblem(null);
    for (const l of [ ...listeners ]) l(key, id);
    setMem({ key, id });
  };
  const complain = (text: string) => { setProblem(text); selectRef.current?.focus(); };

  return {
    enabled, loading: enabled && query.isPending, locations, required, selected, select, problem, setProblem, selectRef,
    ready() {
      if (!enabled) return true;
      if (required && selected === null) { complain(URGENCY_ERRORS.call_location_required); return false; }
      setProblem(null);
      return true;
    },
    refused(err) {
      const code = errorCode(err);
      if (!enabled || (code !== "call_location_required" && code !== "invalid_call_location")) return false;
      if (code === "invalid_call_location") { select(null); void query.refetch(); }
      complain(urgencyError(err));
      return true;
    },
    nameOf(id) { return locations.find((l) => l.id === id)?.name ?? null; }
  };
}

export function CallLocationPicker({ state, label = "Local da chamada" }: { state: CallLocationState; label?: string }) {
  const selectId = useId();
  const problemId = useId();
  if (!state.enabled) return null;
  // Lista carregada, local obrigatório e nenhum ativo: diz onde cadastrar.
  const noLocations = !state.loading && state.required && state.locations.length === 0;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, minWidth: 0, maxWidth: "100%" }}>
      <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <label htmlFor={selectId} style={{ fontSize: 12.5, color: "var(--ink2)" }}>{label}</label>
        <select id={selectId} ref={state.selectRef} value={state.selected ?? ""} onChange={(e) => state.select(e.target.value || null)}
          aria-invalid={state.problem ? true : undefined} aria-describedby={state.problem ? problemId : undefined}
          style={{ ...inputStyle, width: "auto", maxWidth: "100%", marginTop: 0 }}>
          <option value="">— escolha —</option>
          {state.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </span>
      {state.problem && <p id={problemId} role="alert" style={{ margin: 0, fontSize: 12, color: "var(--down)" }}>{state.problem}</p>}
      {noLocations && <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{NO_LOCATIONS_TEXT}</p>}
    </span>
  );
}
