import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RndsStatusTag } from "./RndsStatusTag";

afterEach(cleanup);
const rnds = (over = {}) => ({ status: "not_sent", sent_at: null, accepted_at: null, block_reason: null, error: null, ...over });

describe("RndsStatusTag", () => {
  it("dose ativa não enviada: envio desligado", () => {
    render(<RndsStatusTag rnds={rnds()} />);
    expect(screen.getByText("envio desligado — na fila")).not.toBeNull();
  });
  it("dose cancelada não enviada: nada mais vai à RNDS", () => {
    render(<RndsStatusTag rnds={rnds()} cancelled />);
    expect(screen.getByText("não enviada (dose cancelada)")).not.toBeNull();
    expect(screen.queryByText(/na fila/)).toBeNull();
  });
  it("dose cancelada cuja original foi aceita diz isso", () => {
    render(<RndsStatusTag rnds={rnds({ sent_at: "2026-09-01T09:31:00-03:00", accepted_at: "2026-09-01T09:31:05-03:00" })} cancelled />);
    expect(screen.getByText("não enviada (dose cancelada)")).not.toBeNull();
    expect(screen.getByText(/^a dose original foi aceita em/)).not.toBeNull();
  });
});
