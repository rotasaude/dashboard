// src/modules/ZooAnimals.tsx
// Tela "Animais" do centro de zoonoses (módulo 35b, F-35.11): buscar, cadastrar, ver o histórico e editar. Só a equipe (team).
// O animal aberto vira `AnimalHistory`; a edição e a mudança de situação ocupam o lugar do botão Editar na mesma leitura (uma só
// trilha). Tela velha (409): a frase, UMA releitura, nada reenviado.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Animal } from "../lib/api";
import { cityIsoDate } from "../lib/format";
import { ZOO_ANIMAL_KEY } from "../lib/zoonoses";
import { ActionButton } from "../components/ActionButton";
import { muted, row, stack } from "./exams/styles";
import { AnimalForm, AnimalStatusChange } from "./zoonoses/AnimalForm";
import { AnimalHistory } from "./zoonoses/AnimalHistory";
import { AnimalSearch } from "./zoonoses/AnimalSearch";
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";

type View = { kind: "home" } | { kind: "new" } | { kind: "open"; id: string; editing: boolean };

export function ZooAnimals({ today }: { today?: string } = {}) {
  const client = useQueryClient();
  const [ view, setView ] = useState<View>({ kind: "home" });
  const [ notice, setNotice ] = useState<string | null>(null);
  const day = today ?? cityIsoDate();

  const reread = (id: string) => client.invalidateQueries({ queryKey: [ ZOO_ANIMAL_KEY, id ] });
  const open = (id: string) => { setNotice(null); setView({ kind: "open", id, editing: false }); };

  return (
    <ZoonosesGate title="Animais" sub="zoonoses · animais" allow={(r) => r.team}>
      {() => (
        <div style={stack}>
          {view.kind === "home" && (
            <>
              <div style={row}><ActionButton onClick={() => setView({ kind: "new" })}>Cadastrar animal</ActionButton></div>
              <AnimalSearch onOpen={open} />
            </>
          )}
          {view.kind === "new" && (
            <AnimalForm onSaved={(a: Animal) => open(a.id)} onCancel={() => setView({ kind: "home" })} />
          )}
          {view.kind === "open" && (
            <>
              <div style={row}><ActionButton variant="secondary" onClick={() => { setNotice(null); setView({ kind: "home" }); }}>Voltar à busca</ActionButton></div>
              {notice && <p role="status" style={muted}>{notice}</p>}
              <AnimalHistory
                id={view.id}
                onEdit={() => { setNotice(null); setView({ kind: "open", id: view.id, editing: true }); }}
                editor={view.editing ? (h) => (
                  <>
                    <AnimalForm animal={h} onCancel={() => setView({ kind: "open", id: view.id, editing: false })}
                      onSaved={() => { setView({ kind: "open", id: view.id, editing: false }); void reread(view.id); }}
                      onStale={(text) => { setNotice(text); void reread(view.id); }} />
                    <AnimalStatusChange animal={h} today={day}
                      onSaved={() => { setView({ kind: "open", id: view.id, editing: false }); void reread(view.id); }}
                      onStale={(text) => { setNotice(text); void reread(view.id); }} />
                  </>
                ) : undefined}
              />
            </>
          )}
        </div>
      )}
    </ZoonosesGate>
  );
}
