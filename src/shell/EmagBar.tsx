// Barra de acessibilidade (eMAG 3.1): atalhos 1 conteúdo, 2 menu, 3 busca;
// página de acessibilidade e alto contraste. Os atalhos movem o foco sem
// trocar o hash (o roteador usa o hash para as telas).
import type { MouseEvent } from "react";
import { toggleHighContrast, useTheme } from "../theme/theme";

// Foca o primeiro alvo visível; se nenhum estiver visível, o último da
// lista (o trilho some abaixo de 1024px e o botão Menu assume).
function focusFirst(...ids: string[]) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && (el.offsetParent !== null || id === ids[ids.length - 1])) {
      if (!el.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute("tabindex", "-1");
      el.focus();
      return;
    }
  }
}

export function EmagBar() {
  const theme = useTheme();
  const jump = (...ids: string[]) => (e: MouseEvent<HTMLAnchorElement>) => { e.preventDefault(); focusFirst(...ids); };
  return (
    <div className="shell-emag">
      <div className="shell-emag-group">
        <a href="#conteudo" accessKey="1" onClick={jump("conteudo")}>Ir para o conteúdo [1]</a>
        <a href="#menu-grupos" accessKey="2" onClick={jump("menu-grupos", "menu-botao")}>Ir para o menu [2]</a>
        <a href="#busca-tela" accessKey="3" onClick={jump("busca-tela")}>Ir para a busca [3]</a>
      </div>
      <div className="shell-emag-group">
        <a href="#/acessibilidade">Acessibilidade</a>
        <button type="button" aria-pressed={theme === "alto-contraste"} onClick={toggleHighContrast}>Alto contraste</button>
      </div>
    </div>
  );
}
