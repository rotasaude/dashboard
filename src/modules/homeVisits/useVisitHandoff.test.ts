import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ModuleId } from "../../shell/modules";
import { useVisitHandoff, type VisitStart } from "./useVisitHandoff";

const START: VisitStart = { teamId: "t1", microAreaId: "ma1", householdId: "h1", familyId: "f1", patientId: "pa1", displayName: "Maria Lima" };

describe("useVisitHandoff", () => {
  it("guarda só em memória e apaga ao sair da folha do dia", () => {
    localStorage.clear(); sessionStorage.clear();
    const { result, rerender } = renderHook(({ active }: { active: ModuleId }) => useVisitHandoff(active), { initialProps: { active: "who-to-visit" as ModuleId } });
    expect(result.current.start).toBeNull();
    act(() => result.current.startVisit(START));
    rerender({ active: "home-visit-day" });
    expect(result.current.start).toEqual(START);
    rerender({ active: "who-to-visit" });
    expect(result.current.start).toBeNull();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});
