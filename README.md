# Pixelar

Editor de pixel art, dither, filmes analógicos e animações para **fotos e vídeos**, direto no navegador. Nada é enviado para servidor: tudo roda no aparelho (WebGL2 + WebCodecs).

Interface v5 (refeita do zero em nov/2026, mesma marca “Sol”: âmbar sobre noite ou papel, linhas finas, cantos retos, Departure Mono em 11/22/33 px, ícones em pixel). Espaço em grade de 4 px, toques de no mínimo 44 px.

- **Topo**: Menu · Desfazer · Refazer · **o sol** (toque = combinação surpresa; segure = travas do sorteio) · **Receita** (com contador) · **Exportar**.
- **Ferramentas** (uma barra só; no celular fica no pé da tela, no computador vira coluna à esquerda): **Looks · Cortar · Luz · Cor · Pixel · Efeitos · Mover**. Ponto âmbar = ferramenta em uso; tocar na ferramenta aberta recolhe o painel (a foto ganha a tela). Teclas 1–7 no computador.
- **Painel**: cabeçalho com nome, sortear esta ferramenta e restaurar; até ~5 ajustes principais e o resto em seções que abrem ao tocar (“Mais ajustes”, “Degradê”, “Contorno”…). Cada ajuste é uma linha com régua (arrastar, tocar para pular, toque duplo volta ao padrão).
- **Looks**: Sortear, Original, 12 combinações prontas e os seus looks; o escolhido ganha a régua de intensidade.
- **Efeitos**: Texturas · Filmes · Câmera (grão e lente) · Dupla. A galeria mostra famílias (13 texturas, 6 filmes); as outras ficam como **Variação** da família (ex.: Térmico → Limiar de cor, Canais, Traçado néon). Nada saiu do motor e o dado ainda chega em todas.
- **Receita** (substitui as Camadas): tudo o que está aplicado, com resumo legível, ligar/desligar sem perder os ajustes, mistura e opacidade dos efeitos por cima e arrastar para reordenar. No computador fica fixa no pé do painel.
- **Exportar**: folha (celular) ou janela (computador) com a dimensão final em destaque, formato, tamanho, salvar, copiar e salvar ajustes; Imagem | Animação quando algo se move.
- No pé da foto: **Comparar** (ou segure a foto / espaço no computador) e **Tocar** quando há movimento.

## Como usar localmente

Precisa ser servido por HTTP (não abra o `index.html` direto do disco):

```bash
python3 -m http.server 8000
```

Depois abra `http://localhost:8000`. Para publicar, qualquer hospedagem estática serve (GitHub Pages, Netlify, Vercel).

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | Esqueleto da página |
| `css/app.css` | Todo o visual (tema claro/escuro, celular e desktop) |
| `js/gpu.js` | Motor WebGL2, catálogo de texturas (`PIXELAR_FX_LIST`) e shaders do filme |
| `js/engine.js` | **Estado** (`DEFAULT_STATE`), filmes (`FILM_LOOK_DEFS`), compatibilidade (`normalizeState`) e o render. Também o fallback em CPU |
| `js/paint.js` | Pintura em regiões ou pixels (último passo do render; também gera o SVG vetorial) |
| `js/anim.js` | Animação em loop e o dado: receitas (`RECIPES`), dado por ferramenta (`TOOL_DICE`, `randomizeTool`) |
| `js/config.js` | Lê configurações salvas no PNG exportado ou no `.txt` (inclusive as da primeira versão) |
| `js/media.js` | Abertura de vídeos (MP4/MOV/WebM, AVI de câmera, demais via FFmpeg) |
| `js/export.js` | PNG/JPEG/WebP/SVG, animação e vídeo (MP4/WebM/GIF) |
| `js/icons.js` | Ícones em pixel (desenhos de 12 × 12 em texto) |
| `js/ui.js` | Interface: ferramentas (`TOOLS`, `LUZ_TOOL`…), famílias de efeitos (`FX_FAMILIES`, `FILM_FAMILIES`), looks (`BUILTIN_STYLES`), régua, miniaturas, receita, linha do tempo, exportação |
| `vendor/` | mediabunny 1.57.0 completo (MPL-2.0) e o worker do FFmpeg, carregados só quando necessário |
| `sw.js` | Cache offline (abre instantâneo nas próximas visitas) |
| `icons/logo.svg` | Logo (sol em pixel). `tools/icones.py` gera os PNGs do app a partir dele |
| `tools/galeria.js` | Gera a galeria de todos os efeitos aplicados a duas fotos (Playwright) |
| `tools/estudo.js` | Gera o estudo de filmes e câmeras candidatos (`tools/estudo-filmes.js`), que só entram no app depois de escolhidos |

### A regra que evita "arrumar uma coisa e quebrar outra"

Tudo o que a imagem precisa está num único objeto de estado (`st`). O motor (`engine.js`) **nunca lê a página**: ele recebe o estado e desenha. A interface só altera o estado por caminho (`'adj.exposure'`) e chama `change()`.

- Para **mudar o layout**, mexa só em `ui.js`/`app.css`. O processamento não é afetado.
- Para **criar um controle**, adicione uma linha na ferramenta certa em `ui.js` (`LUZ_TOOL`, `FILME_TOOL`…), por exemplo `R('adj.exposure', 'Exposição', 'exposure', -100, 100)`. `D('Nome')` cria uma divisória.
- Para **criar um filme**, adicione uma linha num dos 4 grupos de `FILM_LOOK_DEFS` (`engine.js`).
- Para **criar uma textura**, adicione um objeto em `PIXELAR_FX_LIST` (`gpu.js`) e o id numa família de `FX_FAMILIES` (`ui.js`): como família nova (aparece na galeria) ou como variação de uma existente.
- Para **criar um look**, adicione uma linha em `BUILTIN_STYLES` (`ui.js`).
- Listas curtas nos seletores (`CROP_SHOWN`, `COLOR_SHOWN`…): valores fora delas continuam valendo e aparecem enquanto estiverem em uso.
- Algo saiu do app? Mapeie o id antigo em `LOOK_ALIAS`, `DITHER_ALIAS` ou `FX_ALIAS` (`engine.js`) para arquivos antigos continuarem abrindo.
- **Ao publicar mudanças, rode `python3 tools/versao.py X.Y.Z`**. Isso carimba a versão nos endereços de todos os arquivos e no `sw.js`. Sem isso, o navegador pode misturar arquivos novos e antigos (o servidor deixa cada arquivo em cache por 10 min) e o app quebra.

### Texturas sem cor fixa

Texturas de forma (Deformação, Fusão, ASCII, Pontilhado, Bitmap, Tela de bolso, Relevo…) usam as cores da própria imagem: a cor fica por conta da ferramenta Cor. Só as texturas cuja cor é o próprio efeito (Térmico, Canais, Limiar de cor, Traçado néon, Risografia, Meio-tom CMYK, Planta azul) definem cores.
