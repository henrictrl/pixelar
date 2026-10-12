# Cartões RINO — 10 frentes + 10 versos

- `saida/` → PDFs prontos para a gráfica (1 página cada, **96×56 mm** = corte 90×50 + sangria 3 mm, vetor, **CMYK**, fontes embutidas, sem senha).
- `previas/` → PNG 300 dpi com guias (vermelho = sangria, preto = corte, azul = segurança 3 mm) e painéis `_painel_frentes.png` / `_painel_versos.png`.
- `gerar.py` → regenera tudo (`python3 gerar.py`; precisa de reportlab, svglib, poppler).

## Regras aplicadas (gabarito Printi + manual RINO)
Sangria de 3 mm preenchida; textos/logos dentro da segurança de 3 mm; CMYK; texto ≥ 8 pt; linhas ≥ 0,5 pt; sem transparência;
degradês lineares na vertical ou 5°, no máx. 3 tons vizinhos da paleta, logo/texto sempre na ponta sólida, logo nunca com degradê.

## CMYK usado (confirmar com prova impressa)
Azul Rino C100 M80 Y35 K35 · Azul Profundo C78 M55 Y32 K20 · Azul Névoa C48 M33 Y22 K6 · Off-white C4 M4 Y6 K0

## Versos (espaço para escrever)
Áreas claras (off-white) com ou sem pauta/quadriculado. Pedir papel fosco/offset sem verniz nem laminação na área de escrita.
