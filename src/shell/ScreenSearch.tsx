// Busca de tela (combobox ARIA 1.2): rótulo, grupo e descrição das telas
// visíveis, sem diferenciar acento nem maiúscula; até 8 resultados.
import { useId, useMemo, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import type { Route } from "./router";
import type { Catalog, ShellGroup } from "./types";

export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function ScreenSearch({ groups, catalog, go }: { groups: ShellGroup[]; catalog: Catalog; go: (r: Route) => void }) {
  const listId = useId();
  const [ query, setQuery ] = useState("");
  const [ active, setActive ] = useState(0);

  const entries = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({
    id: i.id, label: i.label, group: g.label, haystack: normalize(`${i.label} ${g.label} ${catalog.screens[i.id]?.description ?? ""}`)
  }))), [ groups, catalog ]);

  const q = normalize(query.trim());
  const results = q ? entries.filter((e) => e.haystack.includes(q)).slice(0, 8) : [];
  const open = results.length > 0;
  const optionId = (n: number) => `${listId}-opt-${n}`;

  function choose(n: number) {
    const r = results[n];
    if (!r) return;
    setQuery("");
    setActive(0);
    go({ kind: "screen", id: r.id });
  }

  return (
    <div className="shell-search">
      <IconSearch size={16} className="shell-search-icon" aria-hidden="true" />
      <input
        id="busca-tela"
        type="text"
        role="combobox"
        aria-label="Buscar tela"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        placeholder="Buscar tela"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open) { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
          else if (e.key === "ArrowUp" && open) { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
          else if (e.key === "Enter" && open) { e.preventDefault(); choose(active); }
          else if (e.key === "Escape") { setQuery(""); setActive(0); }
        }}
      />
      {open && (
        <div role="listbox" id={listId} aria-label="Telas encontradas">
          {results.map((r, n) => (
            <div key={r.id} id={optionId(n)} role="option" aria-selected={n === active}
              onMouseDown={(e) => { e.preventDefault(); choose(n); }}>
              <span>{r.label}</span>
              <span className="shell-search-meta">{r.group}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
