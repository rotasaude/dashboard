// Chaves de regex do proxy de dev do módulo 24b (usadas por vite.config.ts).
// O Vite casa a regex contra a URL com a query string: `(/|\?|$)` deixa passar
// `/home_visits?team_id=x`, sem casar `/home_visitsX`.
export const MODULE_24B_PROXY_KEYS = [
  "^/home_visits(/|\\?|$)",
  "^/collective_activities(/|\\?|$)",
  "^/field_devices(/|\\?|$)"
];

// Módulo 35a: vigilância ambiental de endemias (inclui /vector_control/reports/<nome>.csv|.pdf). Mesma regra:
// não casa /vector_controlX nem /dashboard/vector_control (a rota do próprio dashboard).
export const MODULE_35A_PROXY_KEYS = [
  "^/vector_control(/|\\?|$)"
];
