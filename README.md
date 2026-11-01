# Pixelar Studio

Editor de pixel art, dither, filmes analógicos e animações para **fotos e vídeos**, direto no navegador. Nada é enviado para servidor: tudo roda no aparelho (WebGL2 + WebCodecs).

Interface flat, no estilo dos apps do iPhone (barras sólidas, sem vidro nem desfoque), com ícones em pixel e a fonte Departure Mono. Na barra de baixo:

- **Estilos**: uma linha só com todos os efeitos (Prontos · Texturas · Filmes · Pintura · Meus estilos). Tocar num efeito aplica e abre, logo acima, a linha de ajustes dele (ícone e nome); tocar num ajuste abre mais uma linha acima com a régua. Tocar de novo fecha — tudo funciona como liga/desliga.
- **Editar**: 7 ferramentas — **Cortar** · **Luz** · **Cor** (paleta, duotone/tritone e degradê) · **Pixel** (tamanho, padrão, agrupar e contorno) · **Lente** (grão, vinheta, brilho, halação, suavidade, distorção, aberração, vazamento) · **Dupla** exposição · **Movimento**. Tocar numa ferramenta abre a lista dos ajustes dela; tocar num ajuste abre o controle.
- **Sortear** (o dado): cada jogada escolhe uma receita (Pixel art, 8-bit, Analógico, Lomografia, P&B, Impressão, Tela e glitch, Pop art, Pintura por números, Pôster, Sonho, Matéria, Duotone, Cinema noturno ou Mistura livre) e devolve ao natural as ferramentas que ela não usa. Cada ferramenta tem o próprio dado (“Sortear Cor”…) e pode ser travada (segurar a ferramenta, ou o cadeado na folha do dado). Segurar o dado abre essa folha; segurar um ajuste trava só ele.
- **Exportar**: um painel só. Foto: PNG, JPEG, WebP ou SVG em Tela, Original (e 2×, 4K, 8K quando a imagem é redesenhada). GIF, MP4 e WebM aparecem quando algo se move. Vídeo: MP4, WebM ou GIF.

Tocar na aba aberta fecha o painel dela. No topo: abrir, desfazer/refazer, tocar (só quando há movimento), **Camadas** (ordem, mesclagem, opacidade e excluir cada efeito) e o menu. Segurar a foto mostra o original; pinça faz zoom. `Esc` fecha janelas.

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
| `vendor/` | mediabunny (MPL-2.0) e o worker do FFmpeg, carregados só quando necessário |
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
