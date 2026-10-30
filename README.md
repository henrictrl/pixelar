# Pixelar Studio

Editor de pixel art, dither, filmes analógicos e animações para **fotos e vídeos**, direto no navegador. Nada é enviado para servidor: tudo roda no aparelho (WebGL2 + WebCodecs).

Interface flat, no estilo dos apps do iPhone (barras sólidas, sem vidro nem desfoque), com ícones em pixel e a fonte Departure Mono. Na barra de baixo:

- **Estilos**: as combinações que você salvou (“Salvar atual”), com a intensidade do estilo.
- **Editar**: 8 ferramentas numa grade. Tocar numa ferramenta abre a lista dos ajustes dela (em seções, com o valor de cada um); tocar num ajuste abre o controle, com “‹ voltar”. Opções e miniaturas ficam em grade com rolagem vertical, nada escondido para os lados. Tocar na ferramenta aberta fecha e devolve o espaço à foto.
  **Cortar** · **Luz** · **Cor** (paleta, duotone/tritone e degradê) · **Pixel** (tamanho, padrão, agrupar e contorno) · **Textura** · **Filme** (filme, grão e lente) · **Dupla** exposição · **Movimento**.
- **Sortear** (o dado): sorteia os ajustes; segurar abre “O que o dado muda”. Segurar um ajuste o trava.
- **Exportar**: um painel só. Foto: PNG, JPEG, WebP ou SVG em Tela, Original (e 2×, 4K, 8K quando a imagem é redesenhada). GIF, MP4 e WebM aparecem quando algo se move. Vídeo: MP4, WebM ou GIF.

Tocar na aba aberta fecha o painel dela. No topo: abrir, desfazer/refazer, tocar (só quando há movimento), **Camadas** (ordem, mesclagem e opacidade dos efeitos) e o menu. Segurar a foto mostra o original; pinça faz zoom. `Esc` fecha janelas.

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
| `js/anim.js` | Animação em loop e o sorteio do dado (`randomize`) |
| `js/config.js` | Lê configurações salvas no PNG exportado ou no `.txt` (inclusive as da primeira versão) |
| `js/media.js` | Abertura de vídeos (MP4/MOV/WebM, AVI de câmera, demais via FFmpeg) |
| `js/export.js` | PNG/JPEG/WebP/SVG, animação e vídeo (MP4/WebM/GIF) |
| `js/icons.js` | Ícones em pixel (desenhos de 12 × 12 em texto) |
| `js/ui.js` | Interface: ferramentas (`TABS`), régua, miniaturas, camadas, linha do tempo, exportação |
| `vendor/` | mediabunny (MPL-2.0) e o worker do FFmpeg, carregados só quando necessário |
| `sw.js` | Cache offline (abre instantâneo nas próximas visitas) |

### A regra que evita "arrumar uma coisa e quebrar outra"

Tudo o que a imagem precisa está num único objeto de estado (`st`). O motor (`engine.js`) **nunca lê a página**: ele recebe o estado e desenha. A interface só altera o estado por caminho (`'adj.exposure'`) e chama `change()`.

- Para **mudar o layout**, mexa só em `ui.js`/`app.css`. O processamento não é afetado.
- Para **criar um controle**, adicione uma linha na ferramenta certa em `ui.js` (`LUZ_TOOL`, `FILME_TOOL`…), por exemplo `R('adj.exposure', 'Exposição', 'exposure', -100, 100)`. `D('Nome')` cria uma divisória.
- Para **criar um filme**, adicione uma linha num dos 4 grupos de `FILM_LOOK_DEFS` (`engine.js`).
- Para **criar uma textura**, adicione um objeto em `PIXELAR_FX_LIST` (`gpu.js`) e o id num grupo de `FX_GROUP_DEFS` (`ui.js`).
- Algo saiu do app? Mapeie o id antigo em `LOOK_ALIAS`, `DITHER_ALIAS` ou `FX_ALIAS` (`engine.js`) para arquivos antigos continuarem abrindo.
- **Ao publicar mudanças, rode `python3 tools/versao.py X.Y.Z`**. Isso carimba a versão nos endereços de todos os arquivos e no `sw.js`. Sem isso, o navegador pode misturar arquivos novos e antigos (o servidor deixa cada arquivo em cache por 10 min) e o app quebra.
