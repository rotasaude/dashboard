// Linha do tempo da manifestação (módulo 33; D16): tipo (código novo do api aparece cru), quando, quem fez e o texto quando há.
// O nome só vem da equipe (`actor_name` lido só quando `actor` é `staff`); cidadão e sistema aparecem como papel. O que foi ao
// cidadão leva a marca "enviada ao cidadão" (o que o próprio cidadão mandou não). `data` não é exibido.
import type { OmbudsmanEvent } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { eventKindLabel } from "../../lib/ombudsman";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { list, muted, row } from "../exams/styles";

function actorText(e: OmbudsmanEvent): string {
  if (e.actor === "staff") return typeof e.actor_name === "string" && e.actor_name !== "" ? e.actor_name : "equipe";
  return e.actor === "citizen" ? "cidadão" : "sistema";
}

export function Timeline({ events }: { events: OmbudsmanEvent[] }) {
  return (
    <Panel title="Linha do tempo">
      {events.length === 0 ? <p style={muted}>sem eventos</p> : (
        <ol style={list}>
          {events.map((e) => (
            <li key={e.id}>
              <div style={row}>
                <strong>{eventKindLabel(e.kind)}</strong>
                <span className="mono" style={muted}>{fmtDateTime(e.at)}</span>
                <span>{actorText(e)}</span>
                {e.visible_to_citizen && e.actor !== "citizen" && <Tag tone="info">enviada ao cidadão</Tag>}
              </div>
              {typeof e.text === "string" && e.text !== "" && <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{e.text}</p>}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
