// src/modules/timeline/TimelineDetail.exam.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getExamOrder: vi.fn() };
});

import * as api from "../../lib/api";
import { TimelineDetail } from "./TimelineDetail";
import { renderWithProviders } from "../../test/campaignFixtures";
import { examOrder, examUser } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

describe("TimelineDetail — exam_order", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser());
    mocked(api.getExamOrder).mockResolvedValue(examOrder());
  });

  it("mostra o exame pela tela de exames e fecha", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TimelineDetail target={{ type: "exam_order", id: "eo1" }} onClose={onClose} />);
    expect(await screen.findByRole("region", { name: "Exame Hemograma completo" })).not.toBeNull();
    expect(api.getExamOrder).toHaveBeenCalledWith("eo1");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalled();
  });
});
