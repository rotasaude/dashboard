import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LabCriticalNotice } from "./LabCriticalNotice";

afterEach(cleanup);

describe("LabCriticalNotice", () => {
  it("nada com zero", () => {
    const { container } = render(<LabCriticalNotice count={0} onOpen={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("singular, plural e o botão que leva à liberação", () => {
    const onOpen = vi.fn();
    render(<LabCriticalNotice count={1} onOpen={onOpen} />);
    expect(screen.getByRole("status").textContent).toContain("1 valor crítico liberado sem registro de aviso");
    fireEvent.click(screen.getByRole("button", { name: "Registrar avisos" }));
    expect(onOpen).toHaveBeenCalled();
    cleanup();
    render(<LabCriticalNotice count={3} onOpen={onOpen} />);
    expect(screen.getByRole("status").textContent).toContain("3 valores críticos liberados sem registro de aviso");
  });
});
