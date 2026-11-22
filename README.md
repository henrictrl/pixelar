# Pixelar Studio

Estúdio fotográfico e de vídeo acelerado por **WebGL2 (GLSL ES 3.00)** — 100% local, sem nuvem, sem assinaturas e preservando 100% da resolução original.

**Acesse direto no navegador (GitHub Pages):**
https://henrictrl.github.io/pixelar/

---

## Experiência Sob Medida Para Cada Dispositivo

O mesmo endereço (`index.html`) se adapta automaticamente ao dispositivo — sem menus espremidos:

- **Desktop / macOS (`> 1024px`):** Estúdio completo estilo câmara escura com palco amplo, histograma RGB vivo, acordeões colapsáveis limpos e barra lateral de ferramentas.
- **iPhone / Celular (Modelo D · Glass Pro):** Cartão flutuante translúcido, **Área Livre Inteligente** (fotos horizontais/quadradas centralizadas sem sobreposição; verticais edge-to-edge), régua tátil de precisão com auto-fade do vidro e carrosséis com rolagem preservada.
- **iPad / Tablet (Layout 5 · Darkroom iPad):** Barra vertical de sessão à esquerda, palco amplo, régua tátil de largura total e popovers de vidro para Curva RGB, HSL, Rodas 3-Vias e módulos do Lab.

> Dica para testar qualquer layout no navegador: adicione `?mode=iphone`, `?mode=ipad` ou `?mode=desktop` ao final da URL.

---

## Principais Recursos

- **Filmes 35mm, Vencidos & Câmeras Cult:** 13 processos químicos reais (incluindo *Vencido Viva* com camadas R/G/B, véu químico, manchas e *light leak*), variações por película e controle contínuo de intensidade.
- **Câmara Escura Completa:** Histograma RGB com alerta de estourados, Auto Luz, Curva de Tons (RGB/R/G/B), Misturador HSL (8 cores), Color Grading 3-Vias, Halação, Pro-Mist, Orton Dream, Anamorphic Flare e Grão orgânico.
- **Laboratório Criativo (Lab) Modular:** 4 módulos colapsáveis — **24 receitas prontas** + Remix, **18 texturas GPU** com 5 modos de mesclagem, **paletas & quantização** (2–256 cores, Duotone e Tritone) e **Pixel Art + Dither** (Bayer 8×8, Atkinson 84, Retícula, Linhas TV).
- **Geometria & Correção de Lente (Padrão Lightroom):** Pass 0 em GPU com endireitar horizonte (±45°), Keystone V/H, Inclinação, Alongar, Escala, Distorção Barril/Almofada, **Restringir Corte (Auto-Zoom)** sem cantos pretos e 6 grades vetoriais de composição.
- **Vídeo & Resgate Sony Cyber-shot `.AVI`:** Parser binário RIFF/AVI (MJPEG + áudio PCM) embutido para reproduzir, aplicar efeitos GPU em tempo real e exportar para MP4/WebM moderno.
- **Exportação Profissional:** PNG sem perdas (com receita embutida em chunk `tEXt` CRC32 válido), JPEG Editorial, WebP, **3D LUT (`.cube` 17×17×17)** para Lightroom/DaVinci Resolve e receitas `.json`.

---

## Apresentações em PDF

- [Apresentação Completa (16:9 · 10 slides)](presentations/Pixelar_Studio_Apresentacao.pdf)
- [Resumo Executivo (A4 · 1 página)](presentations/Pixelar_Studio_Resumo_Executivo.pdf)

---

## Estrutura do Repositório

```text
index.html                   # App Web unificado (Desktop + iPhone Modelo D + iPad Layout 5)
pixelar_studio_v2_pc.html    # Versão Desktop pura (autossuficiente)
sw.js                        # Service Worker PWA (v6.0.0, rede primeiro + cache offline)
manifest.webmanifest         # Manifesto PWA para iOS, iPadOS, Android e Desktop
icons/                       # Ícones oficiais Pixelar (#FDAF00 sobre #0D0D10)
src/                         # Código-fonte modular (shaders GLSL, presets, GPU, vídeo, UI)
build_html.py                # Gera versão Desktop pura
build_unified.py             # Gera versão unificada responsiva
macos/                       # App nativo macOS (Swift + AppKit + WKWebView)
presentations/               # Apresentações editoriais em PDF + gerador
```

## Build Local

```bash
python3 build_html.py
python3 build_unified.py
cp pixelar_studio_unified.html index.html
```
