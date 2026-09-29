// src/modules/campaigns/AudienceBuilder.test.tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { CampaignOptions, Criterion } from "../../lib/api";
import { emptyAudienceDraft, type AudienceDraft } from "../../lib/campaigns";
import { AudienceBuilder } from "./AudienceBuilder";
import { OPTIONS } from "../../test/campaignFixtures";

afterEach(cleanup);
const TODAY = "2026-09-29";
let last: AudienceDraft;

function Harness({ initial, options = OPTIONS }: { initial: AudienceDraft; options?: CampaignOptions }) {
  const [ draft, setDraft ] = useState(initial);
  last = draft;
  return <AudienceBuilder draft={draft} options={options} today={TODAY} onChange={(d) => { last = d; setDraft(d); }} />;
}
const withCriteria = (criteria: Criterion[], geo: AudienceDraft["geo"] = { scope: "city" }): AudienceDraft =>
  ({ geo, criteria: criteria.map((criterion, i) => ({ key: `k${i}`, criterion })) });
const P = { from: "2026-09-01", to: "2026-09-29" };

describe("AudienceBuilder — recorte", () => {
  it("começa na cidade toda, sem critérios", () => {
    render(<Harness initial={emptyAudienceDraft()} />);
    expect((screen.getByRole("radio", { name: "Cidade toda" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("e também")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("unidade de referência: pede a unidade e grava o id", () => {
    render(<Harness initial={emptyAudienceDraft()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Unidade de referência" }));
    expect(screen.getByRole("alert").textContent).toBe("escolha a unidade de referência");
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "u1" } });
    expect(last.geo).toEqual({ scope: "unit", health_unit_id: "u1" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("bairros: seleção múltipla, com contagem", () => {
    render(<Harness initial={emptyAudienceDraft()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Bairros" }));
    expect(screen.getByRole("alert").textContent).toBe("escolha ao menos um bairro");
    fireEvent.click(screen.getByRole("checkbox", { name: "Xaxim" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Boqueirão" }));
    expect(last.geo).toEqual({ scope: "neighborhoods", neighborhood_ids: [ "n2", "n1" ] });
    expect(screen.getByText("2 de no máximo 50 escolhidos")).toBeTruthy();
  });

  it("filtro de bairros ignora acento e maiúscula", () => {
    render(<Harness initial={withCriteria([], { scope: "neighborhoods", neighborhood_ids: [] })} />);
    fireEvent.change(screen.getByLabelText("Filtrar bairros"), { target: { value: "BOQUEIRAO" } });
    expect(screen.getByRole("checkbox", { name: "Boqueirão" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Xaxim" })).toBeNull();
  });

  it("rascunho com bairro fora da lista: aparece e sai ao desmarcar", () => {
    render(<Harness initial={withCriteria([], { scope: "neighborhoods", neighborhood_ids: [ "n1", "sumiu" ] })} />);
    const inactive = screen.getByRole("checkbox", { name: "(bairro inativo)" }) as HTMLInputElement;
    expect(inactive.checked).toBe(true);
    fireEvent.click(inactive);
    expect(last.geo).toEqual({ scope: "neighborhoods", neighborhood_ids: [ "n1" ] });
    expect(screen.queryByRole("checkbox", { name: "(bairro inativo)" })).toBeNull();
  });

  it("rascunho com unidade fora da lista: aparece como (unidade inativa)", () => {
    render(<Harness initial={withCriteria([], { scope: "unit", health_unit_id: "sumiu" })} />);
    const inactive = screen.getByRole("option", { name: "(unidade inativa)" }) as HTMLOptionElement;
    expect(inactive.selected).toBe(true);
    expect((screen.getByLabelText("Unidade") as HTMLSelectElement).value).toBe("sumiu");
    expect(screen.getByRole("alert").textContent).toBe("a unidade deste rascunho não está mais ativa — escolha outra");
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "u2" } });
    expect(last.geo).toEqual({ scope: "unit", health_unit_id: "u2" });
    expect(screen.queryByRole("option", { name: "(unidade inativa)" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("com 50 bairros escolhidos, os outros travam", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `b${i}`, name: `Bairro ${String(i).padStart(2, "0")}` }));
    render(<Harness options={{ ...OPTIONS, neighborhoods: many }}
      initial={withCriteria([], { scope: "neighborhoods", neighborhood_ids: many.slice(0, 50).map((n) => n.id) })} />);
    expect((screen.getByRole("checkbox", { name: "Bairro 50" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Bairro 00" }) as HTMLInputElement).disabled).toBe(false);
  });
});

describe("AudienceBuilder — critérios", () => {
  it("adicionar abre os 7 tipos e cria o cartão com o período padrão", () => {
    render(<Harness initial={emptyAudienceDraft()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar critério clínico" }));
    const menu = within(screen.getByRole("group", { name: "Tipos de critério" }));
    expect(menu.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Protocolo e período", "Faixa da triagem", "Triagem não concluída", "Desfecho de atendimento",
      "Triado e não atendido", "Falta em agendamento", "Pedido de agendamento aberto", "Fechar lista"
    ]);
    fireEvent.click(menu.getByRole("button", { name: "Falta em agendamento" }));
    const card = within(screen.getByRole("region", { name: "Falta em agendamento" }));
    expect((card.getByLabelText("De") as HTMLInputElement).value).toBe("2026-08-31");
    expect((card.getByLabelText("Até") as HTMLInputElement).value).toBe(TODAY);
    expect(screen.queryByRole("group", { name: "Tipos de critério" })).toBeNull();
  });

  it("'e também' entre os cartões", () => {
    render(<Harness initial={withCriteria([
      { kind: "appointment_no_show", ...P }, { kind: "triage_incomplete", ...P }, { kind: "appointment_request_open" }
    ])} />);
    expect(screen.getAllByText("e também")).toHaveLength(2);
  });

  it("remover tira só aquele cartão", () => {
    render(<Harness initial={withCriteria([
      { kind: "appointment_no_show", ...P }, { kind: "triage_incomplete", ...P }, { kind: "appointment_request_open" }
    ])} />);
    fireEvent.click(screen.getByRole("button", { name: "Remover Triagem não concluída" }));
    expect(last.criteria.map((d) => d.criterion.kind)).toEqual([ "appointment_no_show", "appointment_request_open" ]);
    expect(screen.getAllByText("e também")).toHaveLength(1);
  });

  it("mudar um cartão não mexe no outro", () => {
    render(<Harness initial={withCriteria([ { kind: "appointment_no_show", ...P }, { kind: "triage_incomplete", ...P } ])} />);
    const second = within(screen.getByRole("region", { name: "Triagem não concluída" }));
    fireEvent.change(second.getByLabelText("De"), { target: { value: "2026-09-10" } });
    expect(last.criteria[0].criterion).toEqual({ kind: "appointment_no_show", ...P });
    expect(last.criteria[1].criterion).toEqual({ kind: "triage_incomplete", from: "2026-09-10", to: "2026-09-29" });
  });

  it("no máximo 7", () => {
    render(<Harness initial={withCriteria(Array.from({ length: 7 }, () => ({ kind: "appointment_no_show" as const, ...P })))} />);
    expect((screen.getByRole("button", { name: "Adicionar critério clínico" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("no máximo 7 critérios")).toBeTruthy();
  });
});
