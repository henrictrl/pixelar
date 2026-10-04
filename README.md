# Pixelar Studio

Editor de pixel art, dither, filmes analógicos e animações para **fotos e vídeos**, direto no navegador. Nada é enviado para servidor: tudo roda no aparelho (WebGL2 + WebCodecs).

Interface em vidro transparente com ícones em pixel e a fonte Departure Mono. São 3 abas: **Estilos** (Favoritos com estrela, Presets salvos e 5 coleções equilibradas, com intensidade do estilo), **Editar** (Luz e cor, Pixel com Agrupar e Contorno, Textura, Filme e lente, Dupla exposição, Movimento, Cortar) e **Exportar** (Imagem, GIF e Vídeo, em Tela ou Máxima). **Dupla exposição**: uma segunda foto (ou a mesma foto, nuvens, estrelas, ondas de luz, folhagem) com 11 misturas, máscaras pelas luzes/sombras, posição, giro e tom. **Agrupar pixels**: vizinhos de cor parecida viram manchas chapadas. Os ajustes usam uma régua como a do Fotos da Apple. O botão **Camadas** reordena os efeitos sobre a foto, com mesclagem e opacidade. Tema Diurno ou Noturno; em aparelhos modestos, modo leve. A exportação sai sempre na qualidade máxima.

**Para você (Muse):** o app lê a foto (luz, cores, textura, pele, céu, noite, arte gráfica) e monta sugestões pensadas para ela, com paletas harmônicas e de obras de arte. “Novas sugestões” parte da última escolhida, e cada escolha ensina o gosto da pessoa (salvo no aparelho). O dado do topo usa o mesmo motor no modo ousado; cada categoria tem o próprio dado, e segurar um ajuste o trava.

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
| `js/engine.js` | **Estado** (`DEFAULT_STATE`) e o render: recorte → pixel/paleta → camadas na ordem escolhida (`st.layers`) → intensidade. Também o fallback em CPU |
| `js/anim.js` | Animação em loop e o sorteio por seção |
| `js/muse.js` | Variações inteligentes: análise da foto, famílias de estilo, paletas (OKLCH), pontuação e evolução |
| `js/presets.js` | Estilos prontos e conversão de configurações da versão antiga |
| `js/media.js` | Abertura de vídeos (MP4/MOV/WebM, AVI de câmera, demais via FFmpeg) |
| `js/export.js` | PNG/JPEG/WebP/SVG, animação e vídeo (MP4/WebM/GIF) |
| `js/icons.js` | Ícones em pixel (desenhos de 12 × 12 em texto) |
| `js/ui.js` | Interface: abas, régua, miniaturas, camadas, linha do tempo, exportação |
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

Sem atalhos de teclado (saíram na curadoria): `Esc` fecha janelas. Segurar a foto mostra o original; pinça faz zoom.
