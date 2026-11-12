# Pixelar

Editor de pixel art, dither, filmes analógicos e animações para **fotos e vídeos**, direto no navegador. Nada é enviado para servidor: tudo roda no aparelho (WebGL2 + WebCodecs).

Interface “Sol” (v4.6): cores e formas tiradas do logo — âmbar sobre noite (ou o tema claro, Papel), linhas finas, cantos retos e a fonte Departure Mono em 11, 22 e 33 px. Ícones em pixel.

- **Início**: abrir uma foto ou vídeo, ou experimentar com a foto de exemplo (`exemplo.jpg`).
- **Editar**: 7 ferramentas (**Cortar** · **Luz** · **Cor** · **Pixel** · **Lente** · **Dupla** · **Animar**). Tocar numa ferramenta abre a lista dela; cada ajuste é uma linha com nome, régua e valor (arrastar na horizontal, tocar para pular, toque duplo volta ao padrão). Partes extras (Degradê, Agrupar, Contorno…) abrem e fecham ao tocar. No cabeçalho: sortear só esta ferramenta, travar no dado e restaurar. No computador, as ferramentas ficam empilhadas na coluna.
- **Estilos**: Prontos · Texturas · Filmes · Pintura · Meus, em grade. O escolhido ganha uma barra com a intensidade e “Ajustar”.
- **Sortear** (o dado): igual ao anterior. Segurar o dado abre a folha de travas.
- **Exportar**: formato e tamanho em seletores, com as dimensões finais à vista; copiar a imagem e salvar os ajustes num `.txt`.

No topo: abrir, desfazer/refazer, tocar (quando algo se move), **comparar** com o original, **Camadas** e o menu. Segurar a foto também mostra o original; pinça faz zoom. `Esc` fecha janelas.

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
| `js/ui.js` | Interface: ferramentas (`TABS`), régua, miniaturas, camadas, linha do tempo, exportação |
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
- Para **criar uma textura**, adicione um objeto em `PIXELAR_FX_LIST` (`gpu.js`) e o id num grupo de `FX_GROUP_DEFS` (`ui.js`).
- Algo saiu do app? Mapeie o id antigo em `LOOK_ALIAS`, `DITHER_ALIAS` ou `FX_ALIAS` (`engine.js`) para arquivos antigos continuarem abrindo.
- **Ao publicar mudanças, rode `python3 tools/versao.py X.Y.Z`**. Isso carimba a versão nos endereços de todos os arquivos e no `sw.js`. Sem isso, o navegador pode misturar arquivos novos e antigos (o servidor deixa cada arquivo em cache por 10 min) e o app quebra.

### Texturas sem cor fixa

Texturas de forma (Deformação, Fusão, ASCII, Pontilhado, Bitmap, Tela de bolso, Relevo…) usam as cores da própria imagem: a cor fica por conta da ferramenta Cor. Só as texturas cuja cor é o próprio efeito (Térmico, Canais, Limiar de cor, Traçado néon, Risografia, Meio-tom CMYK, Planta azul) definem cores.
