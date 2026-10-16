import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ExamResultBlock } from "./ExamResultBlock";
import { examResult } from "../../test/examFixtures";

afterEach(cleanup);

describe("ExamResultBlock — laboratório municipal (21b)", () => {
  it("fonte lab e retificação vigente", () => {
    render(<ExamResultBlock result={examResult({ source: "lab", laboratory_name: "Laboratório Municipal", replaces_result_id: "er0" })} onExpired={vi.fn()} />);
    const block = screen.getByRole("region", { name: "Resultado" });
    expect(within(block).getByText("Laboratório Municipal · laudo do laboratório municipal")).not.toBeNull();
    expect(within(block).getByText("laudo retificado — substitui o anterior")).not.toBeNull();
  });

  it("substituído: marca, data e título próprio", () => {
    render(<ExamResultBlock superseded result={examResult({ source: "lab", superseded_at: "2026-10-15T11:00:00-03:00" })} onExpired={vi.fn()} />);
    const block = screen.getByRole("region", { name: "Resultado substituído" });
    expect(within(block).getByText("substituído")).not.toBeNull();
    expect(within(block).getByText(/deixou de valer em 15\/10\/2026/)).not.toBeNull();
  });
});
