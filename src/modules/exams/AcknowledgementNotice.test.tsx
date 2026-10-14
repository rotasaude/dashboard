import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AcknowledgementNotice } from "./AcknowledgementNotice";

afterEach(cleanup);

describe("AcknowledgementNotice", () => {
  it("diz quantos resultados e negados e abre a tela", () => {
    const onOpen = vi.fn();
    render(<AcknowledgementNotice pending={2} denied={1} onOpen={onOpen} />);
    expect(screen.getByRole("status").textContent).toBe("2 resultados aguardando sua ciência · 1 exame negado");
    fireEvent.click(screen.getByRole("button", { name: "Ver resultados" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("com mais páginas, mostra 50+", () => {
    render(<AcknowledgementNotice pending={50} denied={0} hasMore onOpen={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("50+ resultados aguardando sua ciência");
  });

  it("nada pendente: não aparece", () => {
    render(<AcknowledgementNotice pending={0} denied={0} onOpen={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Seus exames" })).toBeNull();
  });
});
