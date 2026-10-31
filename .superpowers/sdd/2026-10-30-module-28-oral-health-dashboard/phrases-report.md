# Frases de recusa restantes
Adicionadas ao PROBLEM_TEXT (src/lib/dental.ts): cancel_plan_conflicts_with_completed, too_many_procedure_codes, invalid_changes, invalid_cursor, invalid_limit, invalid_care_type, invalid_request, unit_has_ceo_profile, patient_name_missing, already_installed, terminology_unavailable. Os demais códigos da lista já tinham frase.
Telas de falha do LEDI: GENERATION_REASON (src/lib/production.ts) ganhou too_many_procedure_codes e quantity_exceeds_location_limit; teste em production.test.ts.
Teste: dental.test.ts afirma que 28 códigos mapeiam para frase. tsc limpo; bin/test dashboard src/lib src/modules/dental: 113 arquivos, 1804 testes verdes.
