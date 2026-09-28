# Pixelar Studio

Editor de pixel art, dither, filmes analógicos e animações para **fotos e vídeos**, direto no navegador. Nada é enviado para servidor: tudo roda no aparelho (WebGL2 + WebCodecs).

Interface inspirada no editor do app Fotos da Apple: 4 abas (Estilos · Ajustar · Efeitos · Animar), cada uma com suas seções; botões redondos e régua deslizante no celular; barra lateral no computador. A cor de destaque dos botões vem da cor dominante da imagem que está sendo editada.

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
| `js/gpu.js` | Motor WebGL2 e os shaders dos efeitos e filmes |
| `js/engine.js` | **Estado** (`DEFAULT_STATE`) e o render: recorte → pixel → GPU → contorno. Também o fallback em CPU |
| `js/anim.js` | Animação em loop e o modo aleatório |
| `js/presets.js` | Estilos prontos e conversão de configurações da versão antiga |
| `js/media.js` | Abertura de vídeos (MP4/MOV/WebM, AVI de câmera, demais via FFmpeg) |
| `js/export.js` | PNG/JPEG/WebP/SVG, animação e vídeo (MP4/WebM/GIF) |
| `js/ui.js` | Interface: abas, régua, miniaturas, linha do tempo, exportação |
| `vendor/` | mediabunny (MPL-2.0) e o worker do FFmpeg, carregados só quando necessário |
| `sw.js` | Cache offline (abre instantâneo nas próximas visitas) |

### A regra que evita "arrumar uma coisa e quebrar outra"

Tudo o que a imagem precisa está num único objeto de estado (`st`). O motor (`engine.js`) **nunca lê a página**: ele recebe o estado e desenha. A interface só altera o estado por caminho (`'adj.exposure'`) e chama `change()`.

- Para **mudar o layout**, mexa só em `ui.js`/`app.css`. O processamento não é afetado.
- Para **criar um controle**, adicione uma linha na lista `TABS` em `ui.js` apontando para um campo do estado, por exemplo `R('adj.exposure', 'Exposição', 'exposure', -100, 100)`.
- Para **criar um filme**, adicione uma linha em `FILM_LOOK_DEFS` (`engine.js`).
- Para **criar um estilo pronto**, adicione em `MODERN_PRESETS` e em `PRESET_GROUPS` (`presets.js`).
- **Ao publicar mudanças, rode `python3 tools/versao.py X.Y.Z`** (ex.: `2.9.2`). Isso carimba a versão nos endereços de todos os arquivos e no `sw.js`. Sem isso, o navegador pode misturar arquivos novos e antigos (o servidor deixa cada arquivo em cache por 10 min) e o app quebra.

## Atalhos

`R` aleatório · `Espaço` tocar/parar · segurar `O` mostra o original · `C` comparar lado a lado · `⌘Z`/`⇧⌘Z` desfazer/refazer · `⌘E` exportar · `⌘O` abrir · `1`–`4` abas · `←`/`→` ajustam a régua ativa · `+`/`−`/`0` zoom.
