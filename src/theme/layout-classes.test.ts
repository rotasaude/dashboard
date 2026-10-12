import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => readFileSync(join(src, f), "utf8");

describe("layouts largos têm classe para 768px", () => {
  it.each([
    [ "components/KpiGrid.tsx", /className=\{columns \? "kpi-grid" : undefined\}/ ],
    [ "modules/Overview.tsx", /className="ov-split"[^>]*gridTemplateColumns: "1\.5fr 1fr"/ ],
    [ "modules/Overview.tsx", /className="ov-split"[^>]*gridTemplateColumns: "1fr 1\.4fr"/ ],
    [ "modules/Overview.tsx", /className="[^"]*ov-kv3/ ],
    [ "modules/Overview.tsx", /className="[^"]*ov-event/ ],
    [ "modules/ProtocolEditor.tsx", /className="pe-split"/ ]
  ])("%s %s", (file, re) => expect(read(file)).toMatch(re));

  it("global.css importa responsive.css logo depois dos tokens", () => {
    expect(read("theme/global.css")).toMatch(/@import "\.\/vendor\/tokens\.css";\s*@import "\.\/responsive\.css";/);
  });
});
