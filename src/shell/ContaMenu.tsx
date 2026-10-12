// Menu da conta: e-mail, tema (gov.br, Rota Saúde, Alto contraste) e Sair.
// Mantém o botão aria-label="Conta" e o item "Sair" do UserMenu antigo.
import { useEffect, useRef, useState } from "react";
import { PANEL_THEMES, setTheme, useTheme, type PanelTheme } from "../theme/theme";

const THEME_LABEL: Record<PanelTheme, string> = { govbr: "gov.br", rota: "Rota Saúde", "alto-contraste": "Alto contraste" };

export function ContaMenu({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [ open, setOpen ] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [ open ]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" aria-label="Conta" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        style={{ width: 40, height: 40, borderRadius: 999, background: "var(--ink)", color: "var(--panel)",
          fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>
        {email.slice(0, 2).toUpperCase()}
      </button>
      {open && (
        <div role="menu" className="shell-menu" style={{ left: "auto", right: 0, width: 260 }}>
          <div className="shell-menu-label mono">{email}</div>
          <hr />
          <div className="shell-menu-label" id="tema-label">Tema</div>
          <div role="group" aria-labelledby="tema-label">
            {PANEL_THEMES.map((t) => (
              <button key={t} type="button" role="menuitemradio" aria-checked={theme === t} onClick={() => setTheme(t)}>
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>
          <hr />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>Sair</button>
        </div>
      )}
    </div>
  );
}
