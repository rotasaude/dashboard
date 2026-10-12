import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useDialog } from "./useDialog";

afterEach(cleanup);

function Harness({ onClose }: { onClose: () => void }) {
  const [ open, setOpen ] = useState(false);
  const [ opener, setOpener ] = useState<HTMLButtonElement | null>(null);
  const ref = useDialog<HTMLDivElement>(open, () => { onClose(); setOpen(false); }, opener);
  return (
    <>
      <button ref={setOpener} onClick={() => setOpen(true)}>abrir</button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" aria-label="Painel">
          <input aria-label="campo" />
          <button>último</button>
        </div>
      )}
    </>
  );
}

describe("useDialog", () => {
  it("foca dentro, prende o Tab, Escape fecha e devolve o foco", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "abrir" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText("campo"));
    screen.getByRole("button", { name: "último" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("campo"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
