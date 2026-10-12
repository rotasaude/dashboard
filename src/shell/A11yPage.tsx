// Página de acessibilidade (eMAG 3.1): o que o painel oferece e como relatar
// problema. Estática.
export function A11yPage({ contact }: { contact: string }) {
  return (
    <article style={{ maxWidth: 760 }}>
      <h1 className="shell-page-title">Acessibilidade</h1>
      <p className="shell-page-sub">Este painel segue a WCAG 2.2 nível AA e o eMAG 3.1.</p>
      <h2>Atalhos de teclado</h2>
      <table>
        <thead><tr><th>Tecla</th><th>Vai para</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Conteúdo da página</td></tr>
          <tr><td>2</td><td>Menu de grupos</td></tr>
          <tr><td>3</td><td>Busca de tela</td></tr>
        </tbody>
      </table>
      <p>Use a tecla junto do modificador do seu navegador: Alt no Chrome e no Edge, Alt+Shift no Firefox.</p>
      <h2>Recursos</h2>
      <ul>
        <li>Alto contraste, pelo botão na barra do topo ou pelo menu da conta.</li>
        <li>Temas gov.br e Rota Saúde, no menu da conta. A escolha fica salva neste navegador.</li>
        <li>Foco visível em todo elemento que recebe o teclado.</li>
        <li>Nível de risco mostrado por cor, forma (■ alto, ▲ moderado, ● baixo) e texto.</li>
        <li>Títulos de página e marcos de região para leitores de tela.</li>
      </ul>
      <h2>Encontrou um problema?</h2>
      <p>{contact}</p>
    </article>
  );
}
