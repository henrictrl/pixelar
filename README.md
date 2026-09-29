# Pixelar Studio

Editor de pixel art, dither, filmes analógicos e animações para **fotos e vídeos**, direto no navegador. Nada é enviado para servidor: tudo roda no aparelho (WebGL2 + WebCodecs).

Interface na linguagem do iOS 27 (Liquid Glass): a imagem ocupa a tela toda e os controles flutuam por cima em vidro, que é tingido pelas cores da foto e, no Chrome/Android, refrata o fundo nas bordas. São 4 abas (Estilos · Ajustar · Efeitos · Animar), cada uma com suas seções, sliders de vidro e um cartão de controles que pode ser recolhido (puxador no celular, botão ou tecla `P` no computador). A cor de destaque vem da cor dominante da imagem.

**Variações (Muse):** em Estilos → Variações, o app lê a foto (luz, cores, textura, pele, céu, noite, arte gráfica) e monta sugestões pensadas para ela, com paletas harmônicas e de obras de arte. Os critérios pesam legibilidade, harmonia, pele e detalhe, e cada lote é variado. “Parecidas” explora a partir da escolhida, e cada escolha ensina o gosto da pessoa, que fica salvo no aparelho. O dado do topo usa o mesmo motor no modo ousado: mais cor, mais texturas, sorteio de verdade entre as boas opções e sem repetir a família das últimas jogadas.

**Texturas:** além das clássicas, há ASCII, monitor CRT, miçangas, tricô, pastilhas, holograma, topografia, estrelas, pontilhado, xilogravura, pulsar, papel, vidro canelado, meio-tom CMYK e duplo, água, térmico, relevo, bitmap, nanquim, limiar de cor, lente fantasma, ácido, traçado néon e pincelada. Todas têm ajustes próprios e estilos prontos no grupo “Texturas”.

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
| `js/anim.js` | Animação em loop e o sorteio por seção |
| `js/muse.js` | Variações inteligentes: análise da foto, famílias de estilo, paletas (OKLCH), pontuação e evolução |
| `js/glass.js` | Vidro líquido: mapas de refração gerados para cada peça (Chrome/Android) |
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
- Para **criar um estilo pronto**, adicione em `MODERN_PRESETS` e em `PRESET_GROUPS` (`presets.js`). Use `tone([...])` para a paleta se espalhar pela luz da foto (funciona em qualquer imagem); `pal([...])` troca cada cor pela mais próxima (bom para paletas de console).
- **Ao publicar mudanças, rode `python3 tools/versao.py X.Y.Z`** (ex.: `2.9.2`). Isso carimba a versão nos endereços de todos os arquivos e no `sw.js`. Sem isso, o navegador pode misturar arquivos novos e antigos (o servidor deixa cada arquivo em cache por 10 min) e o app quebra.

## Atalhos

`R` aleatório · `P` mostra/esconde os controles · `Espaço` tocar/parar · segurar `O` mostra o original · `C` comparar lado a lado · `⌘Z`/`⇧⌘Z` desfazer/refazer · `⌘E` exportar · `⌘O` abrir · `1`–`4` abas · `←`/`→` ajustam a régua ativa · `+`/`−`/`0` zoom.
