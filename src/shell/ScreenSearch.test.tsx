import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IconUsers } from "@tabler/icons-react";
import { ScreenSearch } from "./ScreenSearch";
import type { Catalog, ShellGroup } from "./types";

afterEach(cleanup);

const groups: ShellGroup[] = [
  { label: "Atendimento", slug: "atendimento", items: [ { id: "my-agenda", label: "Minha agenda" } ] },
  { label: "e-SUS", slug: "e-sus", items: [ { id: "production", label: "Produção e-SUS" } ] }
];
const meta = (d: string) => ({ icon: IconUsers, description: d });
const catalog: Catalog = {
  groups: {},
  screens: { "my-agenda": meta("Seus horários"), production: meta("Envio da produção") }
};

describe("ScreenSearch", () => {
  it("é um combobox ligado à lista", () => {
    render(<ScreenSearch groups={groups} catalog={catalog} go={vi.fn()} />);
    const box = screen.getByRole("combobox", { name: "Buscar tela" });
    expect(box.id).toBe("busca-tela");
    expect(box.getAttribute("aria-expanded")).toBe("false");
  });

  it("acha sem acento e abre com Enter", () => {
    const go = vi.fn();
    render(<ScreenSearch groups={groups} catalog={catalog} go={go} />);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "producao" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([ expect.stringContaining("Produção e-SUS") ]);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(go).toHaveBeenCalledWith({ kind: "screen", id: "production" });
  });

  it("busca também na descrição e no grupo; setas movem a seleção", () => {
    render(<ScreenSearch groups={groups} catalog={catalog} go={vi.fn()} />);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "e" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const selected = screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
    expect(box.getAttribute("aria-activedescendant")).toBe(selected?.id);
  });

  it("tela fora dos grupos visíveis não aparece; Esc limpa", () => {
    render(<ScreenSearch groups={groups} catalog={catalog} go={vi.fn()} />);
    const box = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "equipe" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("");
  });
});
