/* ==========================================================================
   PIXELAR STUDIO — Ultra-Fast WebGL2 + CPU 2D Engine (Beta 3)
   Features:
     - Full original image quality preserved on export (up to maxTex / 8192px)
     - Native Video & Cyber-shot AVI frame streaming at 30-60 FPS
     - 13 Film Chemistries incl. Redscale, X-Ray Fog, Film Soup & Autochrome
     - Creative Lab: Color Quantization (2..32, Auto/Presets, Duotone, Tritone),
       Recoloring (Hue, Sat, Invert), Pixel/Dither + 12 Practical & Wild FX
       (Starlight Cross-Screen, Fluted Glass, Prism, Motion Smudge, Riso,
        CMYK, Thermal, Pixel Sort, Stained Glass, Neon Trace, Oil, VHS)
     - Zero-thrash separate main/thumb FBO pools + full CPU 2D fallback
   ========================================================================== */
'use strict';

window.StudioGPU = (function () {
  let gl = null;
  let glCanvas = null;
  let ok = false;
  let failed = false;
  let vao = null;
  let maxTex = 4096;

  const progs = {};
  let curveTex = null;
  let palTex = null;
  let lastCurveKey = '';
  let lastPalKey = '';

  const pools = {
    main:  { srcTex: null, srcKey: '', domColor: [0.5, 0.5, 0.5], autoPal: [], targets: [], geomTarget: null, w: 0, h: 0 },
    thumb: { srcTex: null, srcKey: '', domColor: [0.5, 0.5, 0.5], autoPal: [], targets: [], geomTarget: null, w: 0, h: 0 },
  };

  const VS = `#version 300 es
  layout(location = 0) in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  const COMMON = `
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  vec3 rgb2hsl(vec3 c) {
    float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
    float l = (mx + mn) * 0.5, d = mx - mn;
    if (d < 1e-5) return vec3(0.0, 0.0, l);
    float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    float h = (mx == c.r) ? (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0)
            : (mx == c.g) ? (c.b - c.r) / d + 2.0
            : (c.r - c.g) / d + 4.0;
    return vec3(h / 6.0, s, l);
  }

  vec3 hsl2rgb(vec3 hsl) {
    float h = fract(hsl.x), s = clamp(hsl.y, 0.0, 1.0), l = clamp(hsl.z, 0.0, 1.0);
    vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + vec2(7.1, 13.7);
      a *= 0.5;
    }
    return v;
  }
  `;

  // PASS 0: LIGHTROOM GEOMETRY, PERSPECTIVE & LENS CORRECTIONS (60 FPS GPU)
  const GEOMETRY_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uTex;
  uniform float uSrcAspect, uOutAspect;
  uniform float uStraighten, uPerspV, uPerspH, uSkew, uAspectWarp;
  uniform float uScale, uAutoScale, uOffX, uOffY;
  uniform float uDistort, uLensVig;
  uniform int uFlipH, uFlipV;

  void main() {
    vec2 ndc = (vUv - 0.5) * 2.0;
    float totalScale = max(0.2, uScale * uAutoScale);
    vec2 p = ndc / totalScale - vec2(uOffX, uOffY) * 0.5;

    // Transform Aspect stretch/compress
    float aw = pow(2.0, uAspectWarp * 0.65);
    p.x /= aw;
    p.y *= aw;

    // Projective Keystone Perspective (Vertical & Horizontal)
    float kV = uPerspV * 0.42;
    float kH = uPerspH * 0.42;
    float denom = 1.0 - p.y * kV - p.x * kH;
    if (denom <= 0.08) {
      outColor = vec4(0.035, 0.035, 0.043, 1.0);
      return;
    }
    p /= denom;

    // Horizontal Shear / Skew
    p.x += p.y * uSkew * 0.35;

    // Convert to isotropic physical coordinates (height = 1.0, width = uOutAspect)
    vec2 q = vec2(p.x * uOutAspect, p.y);

    // Fine Straighten Rotation in isotropic space
    if (abs(uStraighten) > 0.0001) {
      float cs = cos(uStraighten), sn = sin(uStraighten);
      q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
    }

    // Radial Lens Distortion (Barrel <-> Pincushion) in circular space
    if (abs(uDistort) > 0.0001) {
      float diag = length(vec2(uOutAspect, 1.0));
      vec2 rn = q / diag;
      float r2 = dot(rn, rn);
      float k1 = uDistort * 0.45;
      float k2 = uDistort * uDistort * 0.08 * sign(uDistort);
      q *= (1.0 + k1 * r2 + k2 * r2 * r2);
    }

    // Cover-fit mapping into source aspect
    float coverFactor = min(uSrcAspect / uOutAspect, 1.0);
    vec2 srcUv = vec2(q.x * coverFactor / uSrcAspect, q.y * coverFactor) * 0.5 + 0.5;

    if (uFlipH == 1) srcUv.x = 1.0 - srcUv.x;
    if (uFlipV == 1) srcUv.y = 1.0 - srcUv.y;

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
      outColor = vec4(0.035, 0.035, 0.043, 1.0);
      return;
    }

    vec4 tex = texture(uTex, srcUv);
    vec3 c = tex.rgb;
    if (abs(uLensVig) > 0.001) {
      vec2 vc = vUv - 0.5;
      float vr2 = dot(vc, vc) * 4.0;
      c *= max(0.0, 1.0 + vr2 * uLensVig * 0.55);
    }
    outColor = vec4(clamp(c, 0.0, 1.0), tex.a);
  }`;

  // PASS 1: LIGHTROOM DEVELOP
  const DEVELOP_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uTex;
  uniform sampler2D uCurve;
  uniform float uExposure, uContrast, uHighlights, uShadows, uWhites, uBlacks;
  uniform float uTemp, uTint, uVibrance, uSaturation, uDehaze, uFade;
  uniform float uHslH[8], uHslS[8], uHslL[8];
  uniform int uHslActive;
  uniform vec3 uGradeS, uGradeM, uGradeH;
  uniform float uGradeBalance, uGradeBlend;
  ${COMMON}

  const float BAND_HUES[8] = float[8](0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.625, 0.7639, 0.8889);
  const float BAND_W[8]    = float[8](0.085, 0.085, 0.11, 0.145, 0.13, 0.13, 0.13, 0.115);
  float hueDist(float a, float b) { float d = abs(a - b); return min(d, 1.0 - d); }

  void main() {
    vec4 src = texture(uTex, vUv);
    vec3 c = src.rgb;

    if (abs(uExposure) > 0.0001) {
      c *= pow(2.0, uExposure);
      if (uExposure > 0.0) c = c / (1.0 + max(c - 0.85, 0.0) * 0.45);
    }

    if (abs(uTemp) > 0.0001 || abs(uTint) > 0.0001) {
      c *= vec3(1.0 + uTemp * 0.20 + uTint * 0.07, 1.0 - uTint * 0.13 + uTemp * 0.02, 1.0 - uTemp * 0.20 + uTint * 0.07);
    }

    if (abs(uDehaze) > 0.0001) {
      float dh = uDehaze;
      c = c - min(min(c.r, c.g), c.b) * dh * 0.20;
      c = (c - 0.45) * (1.0 + dh * 0.24) + 0.45;
      c = mix(vec3(luma(max(c, 0.0))), c, 1.0 + dh * 0.16);
    }

    c = max(c, 0.0);
    if (abs(uShadows) > 0.0001 || abs(uHighlights) > 0.0001 || abs(uBlacks) > 0.0001 || abs(uWhites) > 0.0001) {
      float y = luma(c);
      float shM = pow(1.0 - smoothstep(0.0, 0.58, y), 1.35);
      float hiM = pow(smoothstep(0.42, 1.0, y), 1.35);
      float bkM = pow(1.0 - smoothstep(0.0, 0.28, y), 1.6);
      float whM = pow(smoothstep(0.72, 1.0, y), 1.6);
      c += c * uShadows * 0.62 * shM + vec3(uShadows * 0.055 * shM);
      c += (vec3(1.0) - c) * uHighlights * 0.30 * hiM + c * uHighlights * 0.42 * hiM;
      c += vec3(uBlacks * 0.11 * bkM + uWhites * 0.15 * whM);
    }

    c = clamp(c, 0.0, 1.0);
    if (abs(uContrast) > 0.0001) {
      float k = uContrast;
      vec3 lin = (c - 0.5) * (1.0 + k * 0.68) + 0.5;
      vec3 sc = mix(c, c * c * (3.0 - 2.0 * c), clamp(k * 0.60, -0.5, 0.85));
      c = clamp(mix(lin, sc, 0.45), 0.0, 1.0);
    }

    c.r = texture(uCurve, vec2((c.r * 255.0 + 0.5) / 256.0, 0.5)).a;
    c.g = texture(uCurve, vec2((c.g * 255.0 + 0.5) / 256.0, 0.5)).a;
    c.b = texture(uCurve, vec2((c.b * 255.0 + 0.5) / 256.0, 0.5)).a;
    c.r = texture(uCurve, vec2((c.r * 255.0 + 0.5) / 256.0, 0.5)).r;
    c.g = texture(uCurve, vec2((c.g * 255.0 + 0.5) / 256.0, 0.5)).g;
    c.b = texture(uCurve, vec2((c.b * 255.0 + 0.5) / 256.0, 0.5)).b;

    vec3 hsl = rgb2hsl(c);
    if (uHslActive == 1 && hsl.y > 0.015) {
      float dh = 0.0, ds = 0.0, dl = 0.0;
      float cw = smoothstep(0.015, 0.14, hsl.y);
      for (int i = 0; i < 8; i++) {
        float dist = hueDist(hsl.x, BAND_HUES[i]) / BAND_W[i];
        if (dist < 1.0) {
          float w = 0.5 + 0.5 * cos(dist * 3.14159265);
          dh += uHslH[i] * w; ds += uHslS[i] * w; dl += uHslL[i] * w;
        }
      }
      hsl.x = fract(hsl.x + dh * 0.085 * cw + 1.0);
      hsl.y = clamp(hsl.y * (1.0 + ds * 0.85), 0.0, 1.0);
      hsl.z = clamp(hsl.z + dl * 0.22 * cw * (0.3 + 0.7 * hsl.z * (1.0 - hsl.z) * 4.0), 0.0, 1.0);
      c = hsl2rgb(hsl);
    }

    if (abs(uVibrance) > 0.0001 || abs(uSaturation) > 0.0001) {
      float curSat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
      float skinProt = 1.0 - 0.35 * smoothstep(0.02, 0.11, hsl.x) * (1.0 - smoothstep(0.11, 0.20, hsl.x));
      c = mix(vec3(luma(c)), c, max(0.0, 1.0 + uVibrance * (1.0 - curSat) * 0.82 * skinProt + uSaturation));
    }

    if (uGradeS.y > 0.001 || uGradeM.y > 0.001 || uGradeH.y > 0.001 ||
        abs(uGradeS.z) > 0.001 || abs(uGradeM.z) > 0.001 || abs(uGradeH.z) > 0.001) {
      float l = clamp(luma(c), 0.0, 1.0);
      float piv = 0.5 - uGradeBalance * 0.25, spread = 0.22 + uGradeBlend * 0.38;
      float wS = 1.0 - smoothstep(max(0.0, piv - spread), min(1.0, piv + spread * 0.5), l);
      float wH = smoothstep(max(0.0, piv - spread * 0.5), min(1.0, piv + spread), l);
      float wM = clamp(1.0 - abs(l - piv) / max(0.2, spread * 1.15), 0.0, 1.0);
      c += (hsl2rgb(vec3(uGradeS.x, 0.82, 0.5)) - 0.5) * uGradeS.y * 0.38 * wS + vec3(uGradeS.z * 0.12 * wS);
      c += (hsl2rgb(vec3(uGradeM.x, 0.82, 0.5)) - 0.5) * uGradeM.y * 0.30 * wM + vec3(uGradeM.z * 0.12 * wM);
      c += (hsl2rgb(vec3(uGradeH.x, 0.82, 0.5)) - 0.5) * uGradeH.y * 0.38 * wH + vec3(uGradeH.z * 0.12 * wH);
    }

    if (uFade > 0.001) { float f = uFade * 0.14; c = f + c * (1.0 - f * 0.85); }
    outColor = vec4(clamp(c, 0.0, 1.0), src.a);
  }`;

  // PASS 2: FILM CHEMISTRY (13 chemistries incl. Redscale, X-Ray Fog, Film Soup, Autochrome!)
  const FILM_CHEM_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uTex;
  uniform vec2 uRes;
  uniform vec3 uDomColor;
  uniform int uChem; // 0=none,1=vencido_viva,2=cross,3=bleach,4=aerochrome,5=lomopurple,6=technicolor,7=wood_ir,8=bw,9=redscale,10=xray_fog,11=film_soup,12=autochrome
  uniform float uRolloff, uToneAmt;
  uniform vec3 uBwMix, uToneColor;
  uniform float uVAge, uVFog, uVMottle, uVLeak, uVSeed;
  uniform int uVLayer;
  uniform vec3 uVTint;
  ${COMMON}

  vec3 hueRot(vec3 c, float a) {
    const mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    const mat3 fromY = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 y = toY * c; float cs = cos(a), sn = sin(a);
    y.yz = mat2(cs, sn, -sn, cs) * y.yz;
    return fromY * y;
  }
  vec3 toneHsl(vec3 base, float l, float sMult) {
    vec3 h = rgb2hsl(base);
    return hsl2rgb(vec3(h.x, clamp(max(h.y * sMult, 0.26), 0.0, 0.90), l));
  }

  void main() {
    vec4 src = texture(uTex, vUv);
    vec3 c = src.rgb;

    if (uRolloff > 0.001) {
      float r = uRolloff * 1.1;
      vec3 comp = c / (1.0 + c * r) * (1.0 + r * 0.96);
      c = mix(c, comp, smoothstep(0.32, 1.0, luma(c)));
    }

    if (uChem == 1) {
      // Vencido Química Viva (Adaptive)
      vec3 dom = uDomColor;
      float layerIdx = float(uVLayer);
      vec3 lose = (uVLayer == 0) ? vec3(1.0, 0.12, 0.05) :
                  (uVLayer == 1) ? vec3(0.1, 1.0, 0.15) :
                  (uVLayer == 2) ? vec3(0.08, 0.12, 1.0) :
                  ((dom.r > dom.g && dom.r > dom.b) ? vec3(0.25, 0.85, 0.45) :
                   (dom.b > dom.r) ? vec3(0.85, 0.35, 0.15) : vec3(0.35, 0.25, 0.85));
      if (uVLayer == 3) layerIdx = fract(dom.r * 3.7 + dom.g * 2.1) * 3.0;
      vec3 flatC = mix(c, vec3(0.44) + c * 0.38, lose * uVAge * 0.72);
      float m = fbm(vUv * 3.2 + vec2(uVSeed * 4.3, layerIdx * 5.7));
      vec3 fogBase = (uVLayer == 1) ? mix(toneHsl(1.0 - dom, 0.24, 0.65), uVTint * 0.32, 0.55)
                                    : toneHsl(1.0 - dom, 0.19 + m * 0.08, 0.60);
      vec3 col = flatC + fogBase * pow(1.0 - clamp(luma(flatC), 0.0, 1.0), 1.3) * uVFog * 0.58;
      col *= 1.0 + (m - 0.5) * uVMottle * 0.28;
      if (uVLeak > 0.001) {
        vec2 lp = vec2(fract(0.14 + uVSeed * 0.23 + dom.r * 0.35), fract(0.84 - uVSeed * 0.17 + dom.b * 0.35));
        float lk = smoothstep(0.75, 0.0, length((vUv - lp) * vec2(1.0, 0.62)));
        float streak = smoothstep(0.16, 0.0, abs(vUv.x - lp.x)) * smoothstep(0.92, 0.1, abs(vUv.y - lp.y)) * 0.4;
        vec3 lc = mix(toneHsl(dom, 0.56, 1.4), vec3(1.0, 0.52, 0.20), 0.45);
        col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - lc * clamp(lk + streak, 0.0, 1.0) * uVLeak * 0.52);
      }
      c = col;
    } else if (uChem == 2) {
      c = mix(c, vec3(smoothstep(0.04, 0.94, c.r) * 1.03, pow(max(c.g, 0.0), 0.88), c.b * 0.74 + 0.11), 0.56);
    } else if (uChem == 3) {
      float l = luma(c);
      c = mix(c, clamp(0.5 + (mix(vec3(l), c, 0.42) - 0.5) * 1.32, 0.0, 1.0), 0.68);
    } else if (uChem == 4) {
      float fol = clamp(c.g * 1.22 + max(0.0, c.g - max(c.r, c.b)) * 2.0 - c.b * 0.12, 0.0, 1.08);
      c = mix(c, clamp(vec3(fol, c.r * 0.92, c.g * 0.55 + c.b * 0.52), 0.0, 1.0), 0.85);
    } else if (uChem == 5) {
      float gw = clamp((c.g - max(c.r, c.b)) * 3.2, 0.0, 1.0);
      float pw = clamp((min(c.r, c.b) - c.g) * 3.2, 0.0, 1.0);
      vec3 s = mix(hueRot(c, -2.55 * gw + 2.55 * pw), vec3(c.r * 1.02, c.b * 0.88, c.g * 0.55 + c.b * 0.52), 0.30);
      c = mix(c, clamp(s, 0.0, 1.0), 0.85);
    } else if (uChem == 6) {
      vec3 t = vec3(c.r - (c.g + c.b) * 0.5, c.g - (c.r + c.b) * 0.5, c.b - (c.r + c.g) * 0.5);
      c = clamp(c + t * 0.42, 0.0, 1.0);
    } else if (uChem == 7) {
      vec3 h = rgb2hsl(c);
      float leaf = smoothstep(0.06, 0.38, c.g - c.b * 0.8 + (c.g - c.r) * 0.6) * smoothstep(0.08, 0.35, h.y);
      float sky = smoothstep(0.04, 0.28, c.b - max(c.r, c.g) * 0.88);
      c = vec3(clamp(luma(c) * 0.78 + leaf * 1.15 - sky * 0.70, 0.0, 1.0));
    } else if (uChem == 8) {
      c = vec3(clamp(dot(c, uBwMix) / max(0.001, uBwMix.r + uBwMix.g + uBwMix.b), 0.0, 1.0));
    } else if (uChem == 9) {
      // REDSCALE — back-exposed color negative (light hits red/amber layers first)
      float l = luma(c);
      vec3 rs = vec3(
        pow(clamp(c.r * 0.7 + l * 0.42, 0.0, 1.0), 0.82),
        pow(clamp(c.g * 0.55 + c.r * 0.25, 0.0, 1.0), 1.25) * 0.86,
        pow(clamp(c.b * 0.35 + c.g * 0.15, 0.0, 1.0), 1.85) * 0.48
      );
      rs += vec3(0.07, 0.025, 0.005) * (1.0 - l); // warm copper shadow base
      c = mix(c, clamp(rs, 0.0, 1.0), clamp(0.45 + uVAge * 0.55, 0.0, 1.0));
    } else if (uChem == 10) {
      // X-RAY AIRPORT FOG — sinusoidal radiation density bands + cool-olive base veil
      float wave = 0.5 + 0.5 * sin(vUv.x * 11.5 + vUv.y * 2.2 + fbm(vUv * 2.5 + uVSeed) * 2.8);
      float band = smoothstep(0.32, 0.92, wave) * (0.45 + 0.55 * fbm(vUv * 4.0 + uVSeed * 3.0));
      vec3 fogCol = vec3(0.22, 0.28, 0.25);
      float invL = 1.0 - clamp(luma(c), 0.0, 1.0);
      c = mix(c, c * 0.88 + vec3(0.07), uVAge * 0.45);
      c += fogCol * (0.25 + band * 0.75) * invL * uVFog * 0.75;
    } else if (uChem == 11) {
      // FILM SOUP — organic chemical immersion mottling & gentle iridescent hue drift
      float n1 = fbm(vUv * 3.8 + vec2(uVSeed * 2.7, 1.3));
      float n2 = fbm(vUv * 8.2 + vec2(4.1, uVSeed * 5.3));
      float drift = (n1 - 0.5) * 1.15 * uVAge;
      vec3 sc = hueRot(c, drift);
      vec3 stain = hsl2rgb(vec3(fract(n1 * 1.6 + uVSeed * 0.13), 0.55, 0.52));
      float mask = smoothstep(0.44, 0.82, n2) * uVMottle * 0.42;
      c = mix(c, 1.0 - (1.0 - clamp(sc, 0.0, 1.0)) * (1.0 - stain * mask), 0.78);
    } else if (uChem == 12) {
      // AUTOCHROME LUMIÈRE 1907 — microscopic dyed potato starch mosaic (orange/green/violet)
      float cell = max(1.1, min(uRes.x, uRes.y) / 420.0);
      float h = hash12(floor(gl_FragCoord.xy / cell));
      vec3 starch = h < 0.34 ? vec3(1.18, 0.72, 0.46) : (h < 0.68 ? vec3(0.66, 1.15, 0.62) : vec3(0.70, 0.62, 1.18));
      c = mix(c, c * starch, uVAge * 0.42);
      c = mix(c, vec3(luma(c)) * vec3(1.06, 0.98, 0.86), 0.14);
    }

    if (uToneAmt > 0.001) {
      float g = clamp(luma(c), 0.0, 1.0);
      vec3 toned = g < 0.5 ? mix(vec3(0.025), uToneColor, g * 2.0) : mix(uToneColor, vec3(0.985), (g - 0.5) * 2.0);
      c = mix(c, toned, uToneAmt);
    }
    outColor = vec4(clamp(c, 0.0, 1.0), src.a);
  }`;

  // PASS 3: FAST OPTICS
  const OPTICS_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uTex;
  uniform vec2 uRes;
  uniform float uClarity, uSharpen, uHalation, uBloom, uOrton, uAnamorphic;
  uniform vec3 uHalColor;
  uniform float uVignette, uVigMid, uVigFeather, uChroma, uFlash, uLeak, uLeakAngle;
  uniform vec3 uLeakColor;
  uniform float uGrain, uGrainSize, uGrainRough;
  uniform int uGrainMono;
  ${COMMON}
  const float TAU = 6.28318530718;
  vec3 samp(vec2 uv) { return texture(uTex, clamp(uv, 0.0, 1.0)).rgb; }

  void main() {
    vec2 px = 1.0 / uRes;
    float minDim = min(uRes.x, uRes.y);
    vec2 cc = vUv - 0.5;
    float r2 = dot(cc, cc);

    vec3 col = (uChroma > 0.001)
      ? vec3(samp(vUv + cc * uChroma * 0.014 * (0.4 + r2 * 2.2)).r, samp(vUv).g, samp(vUv - cc * uChroma * 0.014 * (0.4 + r2 * 2.2)).b)
      : samp(vUv);

    if (abs(uClarity) > 0.001 || uSharpen > 0.001) {
      vec3 fine = (samp(vUv + vec2(px.x, 0.0)) + samp(vUv - vec2(px.x, 0.0)) + samp(vUv + vec2(0.0, px.y)) + samp(vUv - vec2(0.0, px.y))) * 0.25;
      if (uSharpen > 0.001) col += (col - fine) * uSharpen * 1.35;
      if (abs(uClarity) > 0.001) {
        float rad = max(2.2, minDim * 0.008);
        vec3 broad = (
          samp(vUv + vec2(rad, 0.0) * px) + samp(vUv - vec2(rad, 0.0) * px) +
          samp(vUv + vec2(0.0, rad) * px) + samp(vUv - vec2(0.0, rad) * px) +
          samp(vUv + vec2(rad, rad) * 0.707 * px) + samp(vUv - vec2(rad, rad) * 0.707 * px) +
          samp(vUv + vec2(rad, -rad) * 0.707 * px) + samp(vUv + vec2(-rad, rad) * 0.707 * px)
        ) * 0.125;
        col += (col - broad) * uClarity * 0.70 * max(0.15, 1.0 - abs(luma(col) - 0.5) * 1.65);
      }
    }

    if (uHalation > 0.001 || uBloom > 0.001 || uOrton > 0.001) {
      vec3 glowHi = vec3(0.0), softAll = vec3(0.0);
      float wSum = 0.0, halR = minDim * 0.032;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * TAU / 6.0 + (i >= 6 ? 0.5236 : 0.0);
        float ring = (i < 6) ? 0.42 : 1.0;
        float w = (i < 6) ? 1.4 : 0.75;
        vec3 s = samp(vUv + vec2(cos(a), sin(a)) * ring * halR * px);
        glowHi += s * smoothstep(0.66, 1.0, luma(s)) * w;
        softAll += s * w;
        wSum += w;
      }
      glowHi /= wSum; softAll /= wSum;
      if (uOrton > 0.001) col = mix(col, 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - clamp(softAll * softAll * 1.35, 0.0, 1.0)), uOrton * 0.62);
      if (uBloom > 0.001) col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - clamp((glowHi * 0.8 + softAll * smoothstep(0.52, 1.0, luma(softAll)) * 0.2) * uBloom * 0.95, 0.0, 0.85));
      if (uHalation > 0.001) {
        float he = pow(clamp(luma(glowHi) * 1.35, 0.0, 1.0), 1.15);
        col += mix(uHalColor, vec3(1.0, 0.65, 0.28), he * 0.28) * he * uHalation * 1.15;
      }
    }

    if (uAnamorphic > 0.001) {
      vec3 streak = vec3(0.0);
      float span = uRes.x * 0.12;
      for (int i = -5; i <= 5; i++) {
        float t = float(i) / 5.0;
        vec3 s = samp(vUv + vec2(t * span * px.x, 0.0));
        streak += s * smoothstep(0.78, 1.0, luma(s)) * exp(-t * t * 3.2);
      }
      streak /= 3.6;
      col += mix(vec3(0.45, 0.75, 1.0), streak, 0.45) * luma(streak) * uAnamorphic * 0.82;
    }

    if (uFlash > 0.001) {
      vec2 q = (vUv - vec2(0.5, 0.45)) * vec2(uRes.x / minDim, uRes.y / minDim);
      col *= 1.0 + uFlash * (0.72 * exp(-dot(q, q) * 4.2) - 0.28);
    }

    if (uLeak > 0.001) {
      float ang = uLeakAngle * 0.01745329;
      vec2 dir = vec2(cos(ang), sin(ang)), perp = vec2(-dir.y, dir.x), dv = vUv - (0.5 + dir * 0.78);
      float d = length(dv);
      float lk = smoothstep(0.92, 0.0, d) * (0.75 + 0.3 * fbm(vUv * 4.2 + dir * 2.0))
               + smoothstep(0.14, 0.0, abs(dot(dv, perp))) * smoothstep(1.1, 0.15, d) * 0.48;
      col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - clamp(uLeakColor * lk * uLeak * 0.75, 0.0, 1.0));
    }

    if (abs(uVignette) > 0.001) {
      float dist = length((vUv - 0.5) * vec2(1.0, uRes.y / uRes.x) * 1.414);
      float inner = mix(0.14, 0.78, uVigMid), mask = smoothstep(inner, inner + mix(0.15, 0.85, uVigFeather), dist);
      if (uVignette < 0.0) col *= 1.0 - mask * (-uVignette) * 0.82;
      else col = mix(col, vec3(0.98, 0.97, 0.95), mask * uVignette * 0.55);
    }

    if (uGrain > 0.001) {
      vec2 gp = gl_FragCoord.xy / max(0.4, uGrainSize);
      float n = mix((vnoise(gp * 0.85) - 0.5) * 1.3, hash12(floor(gl_FragCoord.xy)) - 0.5, uGrainRough * 0.62);
      float amt = uGrain * 0.22 * (0.28 + 0.72 * sin(clamp(luma(col), 0.0, 1.0) * 3.14159265));
      if (uGrainMono == 1) col += vec3(n * amt);
      else col += vec3(
        mix(vnoise(gp * 0.85 + 3.1) - 0.5, hash12(floor(gl_FragCoord.xy) + 11.0) - 0.5, uGrainRough * 0.6),
        mix(vnoise(gp * 0.85 + 17.4) - 0.5, hash12(floor(gl_FragCoord.xy) + 29.0) - 0.5, uGrainRough * 0.6),
        mix(vnoise(gp * 0.85 + 41.9) - 0.5, hash12(floor(gl_FragCoord.xy) + 53.0) - 0.5, uGrainRough * 0.6)
      ) * amt * 1.1;
    }

    outColor = vec4(clamp(col, 0.0, 1.0), texture(uTex, vUv).a);
  }`;

  // PASS 4: CREATIVE LAB (Palette Quantization, Recoloring, Pixel/Dither + 18 Wild & Practical FX + Blend Modes!)
  const CREATIVE_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uTex;
  uniform sampler2D uPal;
  uniform vec2 uRes;
  uniform float uPixelSize;
  uniform int uDitherMode;
  uniform float uDitherStr;
  // Color Quantization & Recoloring
  uniform int uColorMode; // 0=all, 1=palette, 2=duotone, 3=tritone, 4=quantCube(48..256)
  uniform int uPalCount;
  uniform int uPalMap;    // 0=nearest, 1=tones(integral), 2=smooth(gradient)
  uniform float uPalMix, uPalHue, uPalSat, uPalLight;
  uniform int uPalInvert;
  uniform vec3 uQuantSteps;
  uniform vec3 uDuo0, uDuo1, uDuo2;
  // Wild & Practical FX:
  // 0=none, 1=starlight, 2=fluted_glass, 3=prism, 4=motion_smudge, 5=riso, 6=cmyk,
  // 7=thermal, 8=pixel_sort, 9=stained_glass, 10=neon_trace, 11=oil, 12=vhs,
  // 13=crt, 14=kaleidoscope, 15=ink, 16=double_exp, 17=solarize, 18=liquid
  uniform int uFxId;
  uniform int uFxBlend; // 0=normal, 1=screen, 2=multiply, 3=overlay, 4=softlight
  uniform float uFxMix, uFxScale, uFxIntensity, uFxParam;
  ${COMMON}

  float bayer8(vec2 p) {
    ivec2 q = ivec2(mod(floor(p), 8.0));
    int x = q.x, y = q.y, v = 0;
    for (int i = 0; i < 3; i++) {
      int bx = (x >> (2 - i)) & 1;
      int by = (y >> (2 - i)) & 1;
      v = (v << 2) | ((bx ^ by) << 1) | by;
    }
    return float(v) / 63.0;
  }

  float atkinsonPat(vec2 p) {
    ivec2 q = ivec2(mod(floor(p), 4.0));
    int x = q.x, y = q.y, v = 0;
    for (int i = 0; i < 2; i++) {
      int bx = (x >> (1 - i)) & 1;
      int by = (y >> (1 - i)) & 1;
      v = (v << 2) | ((bx ^ by) << 1) | by;
    }
    return (float(v) + 0.5) / 16.0;
  }

  float screenDot(vec2 p, float ang, float cs, float amt) {
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 q = R * p / cs, id = floor(q) + 0.5;
    float r = sqrt(clamp(amt, 0.0, 1.0)) * 0.72;
    return smoothstep(r, r - 1.2 / cs, length(q - id));
  }
  vec2 hash2(vec2 p) { return vec2(hash12(p), hash12(p + 17.3)); }
  vec3 heatMap(float t, float style) {
    t = clamp(t, 0.0, 1.0);
    if (style > 0.75) {
      // Night Vision Phosphor Green
      return mix(vec3(0.01, 0.04, 0.02), vec3(0.18, 0.95, 0.38), pow(max(t, 0.0001), 0.85)) + vec3(0.6, 1.0, 0.7) * smoothstep(0.72, 1.0, t) * 0.65;
    } else if (style > 0.50) {
      // Arctic Ice Thermal
      vec3 a = vec3(0.02, 0.05, 0.14), b = vec3(0.06, 0.32, 0.64), c = vec3(0.14, 0.78, 0.88), d = vec3(0.95, 0.98, 1.0);
      return t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34);
    } else if (style > 0.25) {
      // Ironbow Volcanic
      vec3 a = vec3(0.02, 0.01, 0.08), b = vec3(0.45, 0.04, 0.35), c = vec3(0.92, 0.26, 0.06), d = vec3(1.0, 0.86, 0.18), e = vec3(1.0);
      return t < 0.25 ? mix(a, b, t * 4.0) : t < 0.5 ? mix(b, c, (t - 0.25) * 4.0) : t < 0.75 ? mix(c, d, (t - 0.5) * 4.0) : mix(d, e, (t - 0.75) * 4.0);
    }
    vec3 a = vec3(0.02, 0.0, 0.14), b = vec3(0.28, 0.0, 0.62), c = vec3(0.86, 0.05, 0.44), d = vec3(1.0, 0.48, 0.0), e = vec3(1.0, 0.95, 0.35), f = vec3(1.0);
    return t < 0.2 ? mix(a, b, t / 0.2) : t < 0.4 ? mix(b, c, (t - 0.2) / 0.2) : t < 0.6 ? mix(c, d, (t - 0.4) / 0.2) : t < 0.8 ? mix(d, e, (t - 0.6) / 0.2) : mix(e, f, (t - 0.8) / 0.2);
  }

  vec3 applyBlend(vec3 b, vec3 f, int mode) {
    if (mode == 1) return 1.0 - (1.0 - b) * (1.0 - f);
    if (mode == 2) return b * f;
    if (mode == 3) return mix(2.0 * b * f, 1.0 - 2.0 * (1.0 - b) * (1.0 - f), step(0.5, b));
    if (mode == 4) return (1.0 - 2.0 * f) * b * b + 2.0 * f * b;
    return f;
  }

  void main() {
    vec2 uv = vUv;
    float S = max(uRes.x, uRes.y) / 1000.0;
    if (uPixelSize > 1.5) {
      vec2 stepUv = vec2(uPixelSize) / uRes;
      uv = (floor(uv / stepUv) + 0.5) * stepUv;
    }

    vec3 baseCol = texture(uTex, clamp(uv, 0.0, 1.0)).rgb;
    vec3 col = baseCol;

    // 1. Wild & Practical Textures / Optical FX (18 Effects!)
    if (uFxId == 1) {
      // Starlight Cross-Screen Optical Filter (with rotatable spikes!)
      vec3 acc = vec3(0.0);
      float len = (18.0 + uFxScale * 48.0) * S;
      float th = 0.74 - uFxIntensity * 0.18;
      float baseAng = uFxParam * 1.5707963;
      for (int d = 0; d < 4; d++) {
        float ang = baseAng + float(d) * 0.78539816;
        vec2 dir = vec2(cos(ang), sin(ang));
        float wd = (d == 0 || d == 2) ? 1.0 : 0.48;
        for (int i = 1; i <= 6; i++) {
          float t = float(i) / 6.0;
          vec2 o = dir * t * len / uRes;
          vec3 s1 = texture(uTex, clamp(uv + o, 0.0, 1.0)).rgb;
          vec3 s2 = texture(uTex, clamp(uv - o, 0.0, 1.0)).rgb;
          acc += (s1 * smoothstep(th, 1.0, luma(s1)) + s2 * smoothstep(th, 1.0, luma(s2))) * pow(max(0.001, 1.0 - t), 1.5) * wd;
        }
      }
      col = clamp(baseCol + acc / 3.4 * (0.6 + uFxIntensity * 1.4), 0.0, 1.0);
    } else if (uFxId == 2) {
      // Fluted Glass (rotatable Vertical -> Diagonal -> Horizontal!)
      float rib = max(5.0, (8.0 + uFxScale * 44.0) * S);
      float ang = uFxParam * 1.5707963;
      vec2 axis = vec2(cos(ang), sin(ang));
      vec2 p = uv * uRes;
      float coord = dot(p, axis);
      float f = fract(coord / rib) - 0.5;
      vec2 ruv = (p - axis * f * rib * (0.4 + uFxIntensity * 0.85)) / uRes;
      col = (texture(uTex, clamp(ruv, 0.0, 1.0)).rgb + texture(uTex, clamp(ruv + axis * 1.8 / uRes, 0.0, 1.0)).rgb) * 0.5;
      col *= 1.0 - 0.34 * (f * f * 2.2) + 0.12 * smoothstep(0.35, 0.5, -f);
    } else if (uFxId == 3) {
      // Optical Split Prism (rotatable split angle)
      float amt = 0.015 + uFxIntensity * 0.05;
      float ang = (uFxParam - 0.35) * 3.14159;
      vec2 c = uv - 0.5;
      vec2 rc = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c;
      float side = smoothstep(0.18, 0.82, abs(rc.x) * 2.0);
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 off = dir * sign(rc.x) * amt * side + c * amt * 0.35 * side;
      vec3 pr = vec3(texture(uTex, clamp(uv - off * 1.25, 0.0, 1.0)).r, texture(uTex, clamp(uv - off * 0.75, 0.0, 1.0)).g, texture(uTex, clamp(uv - off * 0.25, 0.0, 1.0)).b);
      col = mix(baseCol, 1.0 - (1.0 - baseCol) * (1.0 - pr * 0.72), side * (0.5 + uFxScale * 0.5));
    } else if (uFxId == 4) {
      // Motion Smudge / Wong Kar-wai Step-Print Trail
      float ang = uFxScale * 3.14159;
      vec2 d = vec2(cos(ang), sin(ang)) * (12.0 + uFxIntensity * 44.0) * S / uRes;
      float bi = uFxParam; // 0 = trailing behind, 1 = symmetric bidirectional
      vec3 acc = vec3(0.0); float ws = 0.0;
      for (int i = 0; i < 8; i++) {
        float t = float(i) / 7.0;
        float off = mix(t, (t - 0.5) * 2.0, bi);
        float w = 1.0 - abs(off) * 0.62;
        acc += texture(uTex, clamp(uv - d * off, 0.0, 1.0)).rgb * w;
        ws += w;
      }
      col = acc / ws;
    } else if (uFxId == 5) {
      // Risograph 2-Ink (4 Curated Ink Duos via uFxParam!)
      float offPx = (1.5 + uFxScale * 6.5) * S;
      vec2 o = vec2(offPx, offPx * 0.6) / uRes;
      float la = luma(baseCol), lb = luma(texture(uTex, clamp(uv + o, 0.0, 1.0)).rgb);
      float n1 = hash12(floor(gl_FragCoord.xy / max(1.0, S)) + 3.1), n2 = hash12(floor(gl_FragCoord.xy / max(1.0, S)) + 9.7);
      float a = clamp(smoothstep(0.65, 0.06, la) + (n1 - 0.5) * uFxIntensity * 0.45, 0.0, 1.0);
      float b = clamp(smoothstep(0.95, 0.28, lb) * 0.85 + (n2 - 0.5) * uFxIntensity * 0.45, 0.0, 1.0);
      vec3 inkA = vec3(0.98, 0.28, 0.48), inkB = vec3(0.05, 0.48, 0.78);
      if (uFxParam > 0.75) { inkA = vec3(0.10, 0.10, 0.14); inkB = vec3(0.92, 0.18, 0.16); }
      else if (uFxParam > 0.50) { inkA = vec3(0.05, 0.58, 0.36); inkB = vec3(0.98, 0.34, 0.62); }
      else if (uFxParam > 0.25) { inkA = vec3(0.42, 0.16, 0.76); inkB = vec3(0.98, 0.78, 0.08); }
      col = vec3(0.97, 0.95, 0.90) * mix(vec3(1.0), inkB, b) * mix(vec3(1.0), inkA, a);
    } else if (uFxId == 6) {
      // CMYK Halftone (rotatable screen mesh via uFxParam)
      float cs = max(3.5, (4.0 + uFxScale * 10.0) * S);
      float rot = uFxParam * 1.5708;
      float dens = 0.65 + uFxIntensity * 0.42;
      vec2 p = uv * uRes;
      float k = 1.0 - max(max(baseCol.r, baseCol.g), baseCol.b);
      vec3 cmy = (1.0 - baseCol - k) / max(1.0 - k, 1e-3);
      col = vec3(0.97, 0.95, 0.91);
      col *= 1.0 - screenDot(p, 0.2618 + rot, cs, cmy.x) * vec3(1.0, 0.0, 0.0) * min(0.95, dens);
      col *= 1.0 - screenDot(p, 1.309 + rot, cs, cmy.y) * vec3(0.0, 1.0, 0.0) * min(0.95, dens);
      col *= 1.0 - screenDot(p, 0.0 + rot, cs, cmy.z) * vec3(0.0, 0.0, 1.0) * min(0.95, dens);
      col *= 1.0 - screenDot(p, 0.7854 + rot, cs, k) * min(0.95, dens);
    } else if (uFxId == 7) {
      // Thermal Infrared Camera (4 palettes via uFxParam)
      float l = luma(baseCol);
      col = heatMap((l - 0.5) * (0.85 + uFxIntensity * 0.8) + 0.5 + (uFxScale - 0.5) * 0.45, uFxParam);
    } else if (uFxId == 8) {
      // Pixel Sort (4 directions via uFxParam: down, right, up, left)
      float th = 0.22 + (1.0 - uFxIntensity) * 0.5;
      vec2 dir = uFxParam < 0.25 ? vec2(0.0, -1.0) : (uFxParam < 0.50 ? vec2(1.0, 0.0) : (uFxParam < 0.75 ? vec2(0.0, 1.0) : vec2(-1.0, 0.0)));
      vec2 st = dir * (40.0 + uFxScale * 130.0) * S / 14.0 / uRes;
      vec3 best = baseCol; float bl = luma(best);
      if (bl >= th) {
        for (int i = 1; i <= 14; i++) {
          vec3 s = texture(uTex, clamp(uv + st * float(i), 0.0, 1.0)).rgb;
          float l = luma(s);
          if (l < th) break;
          if (l > bl) { bl = l; best = s; }
        }
      }
      col = best;
    } else if (uFxId == 9) {
      // Stained Glass (Voronoi)
      float cs = max(8.0, (14.0 + uFxScale * 48.0) * S);
      vec2 p = uv * uRes / cs, ip = floor(p), fp = fract(p);
      float d1 = 9.0, d2 = 9.0; vec2 best = vec2(0.0);
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y)), o = hash2(ip + g) * 0.85 + 0.075;
        float d = length(g + o - fp);
        if (d < d1) { d2 = d1; d1 = d; best = ip + g + o; } else if (d < d2) d2 = d;
      }
      vec3 c = texture(uTex, clamp(best * cs / uRes, 0.0, 1.0)).rgb;
      vec3 h = rgb2hsl(c); h.y = min(1.0, h.y * (0.9 + uFxParam * 0.9)); c = hsl2rgb(h);
      col = mix(vec3(0.06, 0.05, 0.05), c * (0.86 + 0.28 * (1.0 - d1)), smoothstep(0.05 + uFxIntensity * 0.09, 0.11 + uFxIntensity * 0.09, d2 - d1));
    } else if (uFxId == 10) {
      // Neon Trace Outline (with hue shift via uFxParam)
      vec2 t = (1.0 + uFxScale * 1.6) * S / uRes;
      float gx = luma(texture(uTex, clamp(uv + vec2(t.x, 0.0), 0.0, 1.0)).rgb) - luma(texture(uTex, clamp(uv - vec2(t.x, 0.0), 0.0, 1.0)).rgb);
      float gy = luma(texture(uTex, clamp(uv + vec2(0.0, t.y), 0.0, 1.0)).rgb) - luma(texture(uTex, clamp(uv - vec2(0.0, t.y), 0.0, 1.0)).rgb);
      float e = smoothstep(0.06, 0.20, length(vec2(gx, gy)));
      vec3 hue = hsl2rgb(vec3(fract(rgb2hsl(baseCol).x + (uFxParam - 0.5)), 0.94, 0.60));
      col = clamp(baseCol * 0.14 + hue * e * (1.0 + uFxIntensity * 1.25), 0.0, 1.0);
    } else if (uFxId == 11) {
      // Oil Painting (Fast Kuwahara + impasto richness)
      float r = max(2.0, (3.0 + uFxScale * 7.5) * S);
      vec3 m[4], q[4];
      for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); q[k] = vec3(0.0); }
      for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
        vec2 o = vec2(float(i) + 0.5, float(j) + 0.5) * (r * 0.5) / uRes;
        vec3 s0 = texture(uTex, clamp(uv + o, 0.0, 1.0)).rgb, s1 = texture(uTex, clamp(uv + vec2(-o.x, o.y), 0.0, 1.0)).rgb;
        vec3 s2 = texture(uTex, clamp(uv - o, 0.0, 1.0)).rgb, s3 = texture(uTex, clamp(uv + vec2(o.x, -o.y), 0.0, 1.0)).rgb;
        m[0] += s0; q[0] += s0 * s0; m[1] += s1; q[1] += s1 * s1; m[2] += s2; q[2] += s2 * s2; m[3] += s3; q[3] += s3 * s3;
      }
      float bestV = 1e9;
      for (int k = 0; k < 4; k++) { m[k] *= 0.25; float v = dot(q[k] * 0.25 - m[k] * m[k], vec3(1.0)); if (v < bestV) { bestV = v; col = m[k]; } }
      vec3 oh = rgb2hsl(col); oh.y = clamp(oh.y * (0.85 + uFxParam * 0.6), 0.0, 1.0); col = hsl2rgb(oh);
      col *= 1.0 + (vnoise(uv * uRes * 0.14 / max(1.0, S)) - 0.5) * uFxIntensity * 0.16;
    } else if (uFxId == 12) {
      // Analog VHS Tape
      float ln = (hash12(vec2(floor(uv.y * uRes.y * 0.5), 3.0)) - 0.5) * 2.0;
      float band = smoothstep(0.92 - uFxParam * 0.18, 1.0, sin(uv.y * 19.0 + uFxParam * 11.0));
      float jit = ln * 0.007 * (uFxIntensity + band * 1.4) * step(0.86 - uFxParam * 0.12, hash12(vec2(floor(uv.y * uRes.y * 0.15), 9.0)));
      vec2 vuv = vec2(uv.x + jit, uv.y);
      float bleed = 0.003 + uFxScale * 0.009;
      col = vec3(texture(uTex, clamp(vuv + vec2(bleed, 0.0), 0.0, 1.0)).r, texture(uTex, clamp(vuv, 0.0, 1.0)).g, texture(uTex, clamp(vuv - vec2(bleed, 0.0), 0.0, 1.0)).b);
      col *= 1.0 - (0.10 + uFxIntensity * 0.22) * (0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159));
      col += (hash12(gl_FragCoord.xy) - 0.5) * (0.05 + uFxIntensity * 0.06 + band * 0.08);
    } else if (uFxId == 13) {
      // Monitor CRT Phosphor Grille + Tube Curvature
      vec2 cc = uv * 2.0 - 1.0;
      float curv = uFxParam * 0.22;
      vec2 cuv = (cc * (1.0 + dot(cc, cc) * curv)) * 0.5 + 0.5;
      if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) {
        col = vec3(0.02, 0.02, 0.03);
      } else {
        float pitch = max(2.0, (2.2 + uFxScale * 4.5) * S);
        vec3 s = vec3(
          texture(uTex, clamp(cuv + vec2(0.0018, 0.0), 0.0, 1.0)).r,
          texture(uTex, clamp(cuv, 0.0, 1.0)).g,
          texture(uTex, clamp(cuv - vec2(0.0018, 0.0), 0.0, 1.0)).b
        );
        float sub = mod(floor(gl_FragCoord.x / max(1.0, pitch * 0.4)), 3.0);
        vec3 mask = sub < 0.5 ? vec3(1.22, 0.78, 0.78) : (sub < 1.5 ? vec3(0.78, 1.22, 0.78) : vec3(0.78, 0.78, 1.22));
        float scan = 1.0 - (0.12 + uFxIntensity * 0.34) * (0.5 + 0.5 * sin(cuv.y * uRes.y / max(1.0, pitch * 0.5) * 3.14159));
        col = mix(s, s * mask, 0.35 + uFxIntensity * 0.45) * scan;
        col *= 1.0 - dot(cc, cc) * (0.14 + curv * 0.6);
      }
    } else if (uFxId == 14) {
      // Radial Kaleidoscope Mirror Prism
      float segs = floor(4.0 + uFxScale * 8.0);
      float zoom = 0.65 + uFxIntensity * 0.9;
      float rot = uFxParam * 6.2831853;
      vec2 c = (uv - 0.5) * vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
      float r = length(c) / zoom;
      float a = atan(c.y, c.x + 1e-6) + rot;
      float sector = 6.2831853 / segs;
      a = mod(a, sector);
      a = abs(a - sector * 0.5);
      vec2 kuv = 0.5 + vec2(cos(a), sin(a)) * r * vec2(min(uRes.x, uRes.y) / uRes.x, min(uRes.x, uRes.y) / uRes.y);
      kuv = abs(mod(kuv + 1.0, 2.0) - 1.0);
      col = texture(uTex, clamp(kuv, 0.0, 1.0)).rgb;
    } else if (uFxId == 15) {
      // Ink Sketch / Editorial Cross-Hatching
      vec2 t = (1.1 + uFxScale * 2.2) * S / uRes;
      float gx = luma(texture(uTex, clamp(uv + vec2(t.x, 0.0), 0.0, 1.0)).rgb) - luma(texture(uTex, clamp(uv - vec2(t.x, 0.0), 0.0, 1.0)).rgb);
      float gy = luma(texture(uTex, clamp(uv + vec2(0.0, t.y), 0.0, 1.0)).rgb) - luma(texture(uTex, clamp(uv - vec2(0.0, t.y), 0.0, 1.0)).rgb);
      float edge = smoothstep(0.05, 0.24, length(vec2(gx, gy)));
      float lum = luma(baseCol);
      vec2 p = gl_FragCoord.xy / max(1.0, S * 1.1);
      float h1 = smoothstep(0.35, 0.65, sin((p.x + p.y) * 0.85));
      float h2 = smoothstep(0.35, 0.65, sin((p.x - p.y) * 0.85));
      float hatch = 1.0;
      if (lum < 0.62) hatch *= mix(1.0, 0.55 + 0.45 * h1, smoothstep(0.62, 0.30, lum) * uFxIntensity);
      if (lum < 0.36) hatch *= mix(1.0, 0.35 + 0.65 * h2, smoothstep(0.36, 0.10, lum) * uFxIntensity);
      vec3 paper = mix(vec3(0.95, 0.91, 0.83), vec3(0.98, 0.98, 0.97), uFxParam);
      vec3 inkC = vec3(0.09, 0.09, 0.11);
      float inkMask = clamp(edge * (0.85 + uFxIntensity * 0.5) + (1.0 - hatch), 0.0, 1.0);
      col = mix(paper, inkC, inkMask);
    } else if (uFxId == 16) {
      // Analog Double Exposure (ghosted shifted + zoomed + warm/cool tint separation)
      float ang = uFxParam * 6.2831853;
      float shift = (0.02 + uFxScale * 0.14);
      float z = 1.0 + (uFxScale - 0.5) * 0.22;
      vec2 duv = (uv - 0.5) / z + 0.5 + vec2(cos(ang), sin(ang)) * shift;
      vec3 ghost = texture(uTex, clamp(duv, 0.0, 1.0)).rgb;
      vec3 warmA = baseCol * vec3(1.06, 0.98, 0.90);
      vec3 coolB = ghost * vec3(0.88, 0.98, 1.12);
      vec3 scr = 1.0 - (1.0 - clamp(warmA, 0.0, 1.0)) * (1.0 - clamp(coolB * (0.55 + uFxIntensity * 0.55), 0.0, 1.0));
      col = clamp(scr, 0.0, 1.0);
    } else if (uFxId == 17) {
      // Sabattier Darkroom Solarization
      float th = 0.2 + uFxScale * 0.65;
      vec3 inv = clamp(1.0 - abs(baseCol - th) / max(0.15, max(th, 1.0 - th)), 0.0, 1.0);
      vec3 mono = vec3(luma(inv));
      vec3 satCol = hsl2rgb(vec3(fract(rgb2hsl(inv).x + uFxParam * 0.4), clamp(rgb2hsl(inv).y * 1.45, 0.0, 1.0), luma(inv)));
      vec3 sol = mix(mono, satCol, smoothstep(0.1, 0.9, uFxParam));
      col = mix(baseCol, clamp(sol, 0.0, 1.0), 0.45 + uFxIntensity * 0.55);
    } else if (uFxId == 18) {
      // Liquid Glass / Water Ripple Refraction
      float freq = 6.0 + uFxScale * 24.0;
      float amp = (0.004 + uFxIntensity * 0.028);
      float ph = uFxParam * 6.2831853;
      vec2 wv = vec2(
        sin(uv.y * freq + ph + fbm(uv * 4.0) * 3.5),
        cos(uv.x * freq * 0.85 - ph + fbm(uv * 4.0 + 5.2) * 3.5)
      ) * amp;
      float ca = amp * 0.35;
      col = vec3(
        texture(uTex, clamp(uv + wv + vec2(ca, 0.0), 0.0, 1.0)).r,
        texture(uTex, clamp(uv + wv, 0.0, 1.0)).g,
        texture(uTex, clamp(uv + wv - vec2(ca, 0.0), 0.0, 1.0)).b
      );
      col += smoothstep(0.75, 1.0, abs(wv.x + wv.y) / max(0.001, amp * 1.6)) * 0.10 * uFxIntensity;
    }

    if (uFxId != 0) {
      vec3 blended = applyBlend(baseCol, clamp(col, 0.0, 1.0), uFxBlend);
      col = mix(baseCol, clamp(blended, 0.0, 1.0), uFxMix);
    }

    // 2. Ordered Dithering
    if (uDitherMode != 0 && uDitherStr > 0.001) {
      vec2 pxPos = floor(gl_FragCoord.xy / max(1.0, uPixelSize));
      float d = 0.0;
      if (uDitherMode == 1) d = (bayer8(pxPos) - 0.5) * 0.40;
      else if (uDitherMode == 2) { vec2 c = mod(pxPos, 4.0) - 2.0; d = (length(c) / 2.6 - 0.5) * 0.45; }
      else if (uDitherMode == 3) d = mod(pxPos.y, 3.0) < 0.5 ? -0.22 : 0.08;
      else if (uDitherMode == 5) d = (atkinsonPat(pxPos) - 0.5) * 0.48;
      else d = (hash12(pxPos) - 0.5) * 0.35;
      col = clamp(col + d * uDitherStr, 0.0, 1.0);
    }

    // 3. Palette Quantization / Integral Tone-Map / Smooth Gradient / Duotone / Tritone
    vec3 prePal = col;
    if (uColorMode == 2) {
      float t = clamp(luma(col), 0.0, 1.0);
      col = mix(uDuo0, uDuo1, t);
    } else if (uColorMode == 3) {
      float t = clamp(luma(col), 0.0, 1.0);
      col = t < 0.5 ? mix(uDuo0, uDuo1, t * 2.0) : mix(uDuo1, uDuo2, (t - 0.5) * 2.0);
    } else if (uColorMode == 4) {
      col = floor(clamp(col, 0.0, 1.0) * uQuantSteps + 0.5) / max(vec3(1.0), uQuantSteps);
    } else if (uColorMode == 1 && uPalCount > 0) {
      if (uPalMap == 2) {
        // Smooth Gradient-Map Recoloring (zero banding!)
        float pos = clamp(luma(col), 0.0, 1.0) * float(max(1, uPalCount - 1));
        int i0 = clamp(int(floor(pos)), 0, uPalCount - 1);
        int i1 = min(uPalCount - 1, i0 + 1);
        vec3 c0 = texture(uPal, vec2((float(i0) + 0.5) / 32.0, 0.5)).rgb;
        vec3 c1 = texture(uPal, vec2((float(i1) + 0.5) / 32.0, 0.5)).rgb;
        col = mix(c0, c1, fract(pos));
      } else if (uPalMap == 1) {
        // Integral Tone-Map (every color in palette distributed across shadows -> highlights)
        float t = clamp(luma(col), 0.0, 0.9999);
        int idx = clamp(int(floor(t * float(uPalCount))), 0, uPalCount - 1);
        col = texture(uPal, vec2((float(idx) + 0.5) / 32.0, 0.5)).rgb;
      } else {
        // Exact Nearest-Color Matching
        float best = 1e9;
        vec3 bestC = col;
        for (int i = 0; i < 32; i++) {
          if (i >= uPalCount) break;
          vec3 pc = texture(uPal, vec2((float(i) + 0.5) / 32.0, 0.5)).rgb;
          vec3 df = col - pc;
          float dist = dot(df, df);
          if (dist < best) { best = dist; bestC = pc; }
        }
        col = bestC;
      }
    }

    // 4. Recoloring adjustments (Hue rotation, Saturation, Lightness, Invert) + Mix
    if (abs(uPalHue) > 0.001 || abs(uPalSat) > 0.001 || abs(uPalLight) > 0.001) {
      vec3 h = rgb2hsl(clamp(col, 0.0, 1.0));
      h.x = fract(h.x + uPalHue + 1.0);
      h.y = clamp(h.y * (1.0 + uPalSat), 0.0, 1.0);
      h.z = clamp(h.z + uPalLight * 0.42, 0.0, 1.0);
      col = hsl2rgb(h);
    }
    if (uPalInvert == 1) col = 1.0 - col;
    if (uColorMode != 0 || abs(uPalHue) > 0.001 || abs(uPalSat) > 0.001 || abs(uPalLight) > 0.001 || uPalInvert == 1) {
      col = mix(prePal, col, uPalMix);
    }

    outColor = vec4(clamp(col, 0.0, 1.0), texture(uTex, vUv).a);
  }`;

  // PASS 5: BLIT + MIX
  const BLIT_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uOrig;
  uniform sampler2D uFinal;
  uniform float uMix;
  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec4 o = texture(uOrig, uv);
    vec4 f = texture(uFinal, uv);
    outColor = vec4(mix(o.rgb, f.rgb, uMix), f.a);
  }`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error('Shader: ' + err);
    }
    return sh;
  }

  function link(fsSrc) {
    const p = gl.createProgram();
    const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      loc[name] = gl.getUniformLocation(p, name);
    }
    return { p, loc };
  }

  function makeTex(w, h, linear = true) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  function init() {
    if (ok) return true;
    if (failed) return false;
    try {
      glCanvas = document.createElement('canvas');
      gl = glCanvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
      if (!gl) { failed = true; return false; }
      maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      progs.dev = link(DEVELOP_FS);
      progs.blit = link(BLIT_FS);

      pools.main.srcTex = makeTex(0, 0, true);
      pools.thumb.srcTex = makeTex(0, 0, true);
      curveTex = makeTex(256, 1, true);
      palTex = makeTex(32, 1, false);
      ok = true;
      return true;
    } catch (e) {
      console.warn('[Pixelar Studio] WebGL2 fallback para CPU 2D:', e);
      failed = true;
      return false;
    }
  }

  function getProg(name, src) {
    if (!progs[name]) progs[name] = link(src);
    return progs[name];
  }

  function ensurePoolTargets(pool, w, h) {
    if (pool.w === w && pool.h === h && pool.targets.length === 2 && pool.geomTarget) return;
    pool.targets.forEach(t => { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); });
    if (pool.geomTarget) { gl.deleteFramebuffer(pool.geomTarget.fb); gl.deleteTexture(pool.geomTarget.tex); }
    pool.targets = [];
    const mkTarget = () => {
      const tex = makeTex(w, h, true);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    };
    pool.targets.push(mkTarget(), mkTarget());
    pool.geomTarget = mkTarget();
    pool.w = w; pool.h = h;
  }

  // Fast 24x24 analysis for dominant color + automatic Median-Cut palette extraction
  const domScratch = document.createElement('canvas');
  domScratch.width = 24; domScratch.height = 24;
  const domCtx = domScratch.getContext('2d', { willReadFrequently: true });

  function analyzeCanvas(canvas) {
    domCtx.drawImage(canvas, 0, 0, 24, 24);
    const d = domCtx.getImageData(0, 0, 24, 24).data;
    let ar = 0, ag = 0, ab = 0, wsum = 0;
    const pixels = [];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      pixels.push([r, g, b]);
      const rf = r / 255, gf = g / 255, bf = b / 255;
      const mx = Math.max(rf, gf, bf), mn = Math.min(rf, gf, bf);
      const l = (mx + mn) * 0.5, s = mx === mn ? 0 : (mx - mn) / (l > 0.5 ? 2 - mx - mn : mx + mn);
      const w = s * (1 - Math.abs(l - 0.5) * 1.4) + 0.04;
      ar += rf * w; ag += gf * w; ab += bf * w; wsum += w;
    }
    return { domColor: [ar / wsum, ag / wsum, ab / wsum], pixels };
  }

  function medianCut(pixels, count) {
    if (!pixels.length) return [[0, 0, 0]];
    const buckets = [pixels];
    while (buckets.length < count) {
      let maxR = -1, target = -1, axis = 0;
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i]; if (b.length < 2) continue;
        let lo = [255, 255, 255], hi = [0, 0, 0];
        for (const p of b) {
          if (p[0] < lo[0]) lo[0] = p[0]; if (p[0] > hi[0]) hi[0] = p[0];
          if (p[1] < lo[1]) lo[1] = p[1]; if (p[1] > hi[1]) hi[1] = p[1];
          if (p[2] < lo[2]) lo[2] = p[2]; if (p[2] > hi[2]) hi[2] = p[2];
        }
        const rr = hi[0] - lo[0], gr = hi[1] - lo[1], br = hi[2] - lo[2];
        const rng = Math.max(rr, gr, br);
        if (rng > maxR) { maxR = rng; target = i; axis = rr === rng ? 0 : (gr === rng ? 1 : 2); }
      }
      if (target < 0) break;
      const b = buckets[target].slice().sort((a, c) => a[axis] - c[axis]);
      const mid = b.length >> 1;
      buckets.splice(target, 1, b.slice(0, mid), b.slice(mid));
    }
    return buckets.map(b => {
      let r = 0, g = 0, bl = 0;
      for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
      return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)];
    });
  }

  function rgbLuma(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function rgbToHex(c) {
    return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  const QUANT_STEPS = {
    48:  [3, 3, 2],
    64:  [3, 3, 3],
    128: [4, 5, 4],
    256: [5, 6, 5],
  };

  function resolvePaletteColors(lab, pixels) {
    const mode = lab.colorMode;
    if (mode === 'all' || mode === 'duotone' || mode === 'tritone') return [];
    const req = parseInt(mode, 10) || 8;
    const count = Math.max(2, Math.min(32, req));

    // User customized or shuffled palette -> keep exact order!
    if (lab.paletteId === 'custom' && Array.isArray(lab.customPal) && lab.customPal.length >= 2) {
      return lab.customPal.slice(0, 32).map(hx => window.hexToRgb01(hx).map(v => Math.round(v * 255)));
    }

    const preset = window.LAB_PALETTES && window.LAB_PALETTES[lab.paletteId];
    if (preset && preset.colors && preset.colors.length) {
      const base = preset.colors.map(hx => window.hexToRgb01(hx).map(v => Math.round(v * 255)));
      base.sort((a, b) => rgbLuma(a) - rgbLuma(b));
      if (req <= base.length) {
        // Sample evenly across dark -> light so highlights & shadows are always preserved!
        if (req === base.length) return base;
        const out = [];
        for (let i = 0; i < req; i++) {
          const idx = Math.round((i / Math.max(1, req - 1)) * (base.length - 1));
          out.push(base[idx]);
        }
        return out;
      }
      const out = [];
      for (let i = 0; i < count; i++) {
        const t = (i / (count - 1)) * (base.length - 1);
        const a = Math.floor(t), b = Math.min(a + 1, base.length - 1), k = t - a;
        out.push([
          Math.round(base[a][0] + (base[b][0] - base[a][0]) * k),
          Math.round(base[a][1] + (base[b][1] - base[a][1]) * k),
          Math.round(base[a][2] + (base[b][2] - base[a][2]) * k),
        ]);
      }
      return out;
    }

    if (req > 32) return [];
    const cols = medianCut(pixels || [], count);
    cols.sort((a, b) => rgbLuma(a) - rgbLuma(b));
    return cols;
  }

  function resolvePalMapCode(lab) {
    if (lab.palMap === 'nearest') return 0;
    if (lab.palMap === 'tones') return 1;
    if (lab.palMap === 'smooth') return 2;
    // 'auto': photo's own extracted palette uses nearest-color; curated/custom palettes use Integral Smooth/Tone recoloring!
    return lab.paletteId === 'auto' ? 0 : 2;
  }

  function getActivePaletteHex(lab) {
    const cols = resolvePaletteColors(lab, pools.main.autoPal);
    return cols.map(rgbToHex);
  }

  const CHEM_MAP = {
    none: 0, vencido_viva: 1, cross: 2, bleach: 3, aerochrome: 4, lomopurple: 5,
    technicolor: 6, wood_ir: 7, bw: 8, redscale: 9, xray_fog: 10, film_soup: 11, autochrome: 12,
  };
  const DITHER_MAP = { none: 0, bayer8: 1, halftone: 2, scanlines: 3, noise: 4, atkinson: 5 };
  const FX_MAP = {
    none: 0, starlight: 1, fluted_glass: 2, prism: 3, motion_smudge: 4, riso: 5, cmyk: 6,
    thermal: 7, pixel_sort: 8, stained_glass: 9, neon_trace: 10, oil: 11, vhs: 12,
    crt: 13, kaleidoscope: 14, ink: 15, double_exp: 16, solarize: 17, liquid: 18,
  };
  const FX_BLEND_MAP = { normal: 0, screen: 1, multiply: 2, overlay: 3, softlight: 4 };
  const ASPECTS = { original: null, '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '2:3': 2 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16, '21:9': 21 / 9 };

  const prepMap = {
    main:  { canvas: document.createElement('canvas'), key: '' },
    thumb: { canvas: document.createElement('canvas'), key: '' },
  };
  prepMap.main.ctx = prepMap.main.canvas.getContext('2d');
  prepMap.thumb.ctx = prepMap.thumb.canvas.getContext('2d');

  function mediaDims(m) {
    if (m.videoWidth) return { W: m.videoWidth, H: m.videoHeight };
    return { W: m.naturalWidth || m.width, H: m.naturalHeight || m.height };
  }

  function isGeometryActive(crop, srcAspect, outAspect) {
    if (!crop) return false;
    return Math.abs(srcAspect - outAspect) > 0.001 ||
      Math.abs(crop.straighten || 0) > 0.001 ||
      !!crop.flipH || !!crop.flipV ||
      Math.abs(crop.perspV || 0) > 0.001 ||
      Math.abs(crop.perspH || 0) > 0.001 ||
      Math.abs(crop.skew || 0) > 0.001 ||
      Math.abs(crop.aspectWarp || 0) > 0.001 ||
      Math.abs((crop.scale ?? 100) - 100) > 0.001 ||
      Math.abs(crop.offsetX || 0) > 0.001 ||
      Math.abs(crop.offsetY || 0) > 0.001 ||
      Math.abs(crop.distortion || 0) > 0.001 ||
      Math.abs(crop.lensVignette || 0) > 0.001;
  }

  // Exact Lightroom Constrain-Crop solver (binary search on 32 perimeter samples, <0.03ms)
  function computeAutoConstrainScale(crop, srcAspect, outAspect) {
    if (!crop || !crop.constrainCrop) return 1.0;
    const stRad = ((crop.straighten || 0) * Math.PI) / 180;
    const kV = ((crop.perspV || 0) / 100) * 0.42;
    const kH = ((crop.perspH || 0) / 100) * 0.42;
    const sk = ((crop.skew || 0) / 100) * 0.35;
    const aw = Math.pow(2, ((crop.aspectWarp || 0) / 100) * 0.65);
    const dist = (crop.distortion || 0) / 100;
    if (Math.abs(stRad) < 1e-4 && Math.abs(kV) < 1e-4 && Math.abs(kH) < 1e-4 &&
        Math.abs(sk) < 1e-4 && Math.abs(aw - 1) < 1e-4 && Math.abs(dist) < 1e-4) {
      return 1.0;
    }
    const cs = Math.cos(stRad), sn = Math.sin(stRad);
    const diag = Math.hypot(outAspect, 1.0);
    const k1 = dist * 0.45, k2 = dist * dist * 0.08 * Math.sign(dist);
    const coverFactor = Math.min(srcAspect / outAspect, 1.0);

    const pts = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const t = -1 + (2 * i) / N;
      pts.push([t, -1], [t, 1], [-1, t], [1, t]);
    }

    const fits = (sc) => {
      for (let i = 0; i < pts.length; i++) {
        let px = pts[i][0] / sc / aw;
        let py = (pts[i][1] / sc) * aw;
        const denom = 1.0 - py * kV - px * kH;
        if (denom <= 0.12) return false;
        px /= denom; py /= denom;
        px += py * sk;
        let qx = px * outAspect, qy = py;
        if (Math.abs(stRad) > 1e-4) {
          const rx = qx * cs - qy * sn, ry = qx * sn + qy * cs;
          qx = rx; qy = ry;
        }
        if (Math.abs(dist) > 1e-4) {
          const r2 = (qx * qx + qy * qy) / (diag * diag);
          const rad = 1.0 + k1 * r2 + k2 * r2 * r2;
          qx *= rad; qy *= rad;
        }
        const u = (qx * coverFactor / srcAspect) * 0.5 + 0.5;
        const v = (qy * coverFactor) * 0.5 + 0.5;
        if (u < 0.0005 || u > 0.9995 || v < 0.0005 || v > 0.9995) return false;
      }
      return true;
    };

    if (fits(1.0)) return 1.0;
    let lo = 1.0, hi = 4.5;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) * 0.5;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  function prepareSource(poolName, img, crop, maxDim, imgId, forceRefresh) {
    const pm = prepMap[poolName];
    const { W, H } = mediaDims(img);
    const rot = (((crop && crop.rot) || 0) % 360 + 360) % 360;
    const rw = (rot % 180) ? H : W, rh = (rot % 180) ? W : H;
    const srcAspect = rw / Math.max(1, rh);

    // Output framed dimensions according to crop.aspect
    let cw = rw, ch = rh;
    const ar = ASPECTS[crop && crop.aspect];
    if (ar) { if (srcAspect > ar) cw = rh * ar; else ch = rw / ar; }
    const lim = Math.min(maxDim || Math.max(rw, rh), ok ? maxTex : 4096);
    const outLong = Math.max(cw, ch);
    const outScale = (lim && outLong > lim) ? lim / outLong : 1;
    const dw = Math.max(2, Math.round(cw * outScale));
    const dh = Math.max(2, Math.round(ch * outScale));

    // Source texture dimensions (only depends on imgId, rot, lim — NEVER re-uploads when dragging geometry sliders!)
    const srcLong = Math.max(rw, rh);
    const srcScale = (lim && srcLong > lim) ? lim / srcLong : 1;
    const sw = Math.max(2, Math.round(rw * srcScale));
    const sh = Math.max(2, Math.round(rh * srcScale));

    const key = forceRefresh ? ('dyn_' + Math.random()) : `${imgId}|${sw}x${sh}|r${rot}`;
    if (forceRefresh || key !== pm.key || pm.canvas.width !== sw || pm.canvas.height !== sh) {
      if (pm.canvas.width !== sw || pm.canvas.height !== sh) { pm.canvas.width = sw; pm.canvas.height = sh; }
      const ctx = pm.ctx;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      ctx.clearRect(0, 0, sw, sh);
      ctx.translate(sw / 2, sh / 2);
      if (rot) ctx.rotate((rot * Math.PI) / 180);
      const drawScale = sw / rw;
      ctx.scale(drawScale, drawScale);
      ctx.drawImage(img, -W / 2, -H / 2, W, H);
      ctx.restore();
      pm.key = key;
    }
    return { canvas: pm.canvas, sw, sh, w: dw, h: dh, srcAspect, outAspect: dw / Math.max(1, dh), key };
  }

  function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

  // CPU 2D FALLBACK (when WebGL2 is unavailable)
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function smoothstep(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
  function rgb2hslCPU(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) * 0.5, d = mx - mn;
    if (d < 1e-5) return [0, 0, l];
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
    return [h / 6, s, l];
  }
  function hsl2rgbCPU(h, s, l) {
    h = ((h % 1) + 1) % 1;
    if (s <= 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1/6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2/3 ? p + (q - p) * (2/3 - t) * 6 : p; };
    return [f(h + 1/3), f(h), f(h - 1/3)];
  }
  const BAND_HUES_CPU = [0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.625, 0.7639, 0.8889];
  const BAND_W_CPU = [0.085, 0.085, 0.11, 0.145, 0.13, 0.13, 0.13, 0.115];

  function renderCPU(img, imgId, st, outCanvas, opts = {}) {
    const poolName = opts.pool === 'thumb' ? 'thumb' : 'main';
    const maxDim = opts.isExport ? (opts.maxDim || 4096) : Math.min(opts.maxDim || 760, poolName === 'thumb' ? 140 : 760);
    const prep = prepareSource(poolName, img, st.crop, maxDim, imgId, opts.isVideo);
    const w = prep.w, h = prep.h;
    if (outCanvas.width !== w || outCanvas.height !== h) { outCanvas.width = w; outCanvas.height = h; }
    const ctx = outCanvas.getContext('2d', { willReadFrequently: true });
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    const c = st.crop || {};
    const coverScale = Math.max(w / prep.sw, h / prep.sh) * ((c.scale ?? 100) / 100) * computeAutoConstrainScale(c, prep.srcAspect, prep.outAspect);
    if (c.flipH) ctx.scale(-1, 1);
    if (c.flipV) ctx.scale(1, -1);
    if (c.straighten) ctx.rotate((c.straighten * Math.PI) / 180);
    ctx.scale(coverScale, coverScale);
    ctx.drawImage(prep.canvas, -prep.sw / 2 + ((c.offsetX || 0) / 100) * prep.sw * 0.25, -prep.sh / 2 + ((c.offsetY || 0) / 100) * prep.sh * 0.25, prep.sw, prep.sh);
    ctx.restore();
    if (opts.origCanvas) {
      if (opts.origCanvas.width !== w || opts.origCanvas.height !== h) { opts.origCanvas.width = w; opts.origCanvas.height = h; }
      opts.origCanvas.getContext('2d').drawImage(outCanvas, 0, 0, w, h);
    }

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const lutRGB = window.evalCurve256(st.curve.rgb), lutR = window.evalCurve256(st.curve.r), lutG = window.evalCurve256(st.curve.g), lutB = window.evalCurve256(st.curve.b);
    const expMult = Math.pow(2, st.light.exposure);
    const cont = st.light.contrast / 100, hi = st.light.highlights / 100, sh = st.light.shadows / 100;
    const wh = st.light.whites / 100, bk = st.light.blacks / 100;
    const temp = st.color.temp / 100, tint = st.color.tint / 100;
    const wbR = 1 + temp * 0.20 + tint * 0.07, wbG = 1 - tint * 0.13 + temp * 0.02, wbB = 1 - temp * 0.20 + tint * 0.07;
    const vib = st.color.vibrance / 100, sat = st.color.saturation / 100;
    const fade = st.presence.fade / 100 * 0.14;
    const roll = st.film.rolloff / 100 * 1.1;
    const chem = CHEM_MAP[st.film.chem] || 0;
    const mix = (st.preset.mix ?? 100) / 100;
    const analysis = (chem === 1 || st.lab.colorMode !== 'all') ? analyzeCanvas(prep.canvas) : { domColor: [0.5, 0.5, 0.5], pixels: [] };
    const dom = analysis.domColor;
    const domCompH = chem === 1 ? rgb2hslCPU(1 - dom[0], 1 - dom[1], 1 - dom[2]) : [0, 0, 0];
    const vFogRGB = chem === 1 ? hsl2rgbCPU(domCompH[0], Math.max(0.26, domCompH[1] * 0.6), 0.22) : [0, 0, 0];
    const vAge = st.film.vencidoAge / 100, vFog = st.film.vencidoFog / 100;
    const bm = st.film.bwMix || [30, 59, 11], bmSum = Math.max(0.001, bm[0] + bm[1] + bm[2]);
    const toneAmt = st.film.toneAmt / 100, toneRGB = window.hexToRgb01(st.film.toneColor);
    const vig = st.optics.vignette / 100;
    const palCols = resolvePaletteColors(st.lab, analysis.pixels).map(c => [c[0]/255, c[1]/255, c[2]/255]);
    const duo0 = window.hexToRgb01(st.lab.duo0), duo1 = window.hexToRgb01(st.lab.duo1), duo2 = window.hexToRgb01(st.lab.duo2);
    const palHue = st.lab.palHue / 360, palSat = st.lab.palSat / 100, palInv = !!st.lab.palInvert;

    for (let y = 0; y < h; y++) {
      const ny = y / h - 0.5;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const or = d[i] / 255, og = d[i + 1] / 255, ob = d[i + 2] / 255;
        let r = Math.max(0, or * expMult * wbR), g = Math.max(0, og * expMult * wbG), b = Math.max(0, ob * expMult * wbB);
        if (sh || hi || bk || wh) {
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const shM = Math.pow(1 - smoothstep(0, 0.58, l), 1.35), hiM = Math.pow(smoothstep(0.42, 1, l), 1.35);
          const add = sh * 0.055 * shM + bk * 0.11 * Math.pow(1 - smoothstep(0, 0.28, l), 1.6) + wh * 0.15 * Math.pow(smoothstep(0.72, 1, l), 1.6);
          r = r + r * sh * 0.62 * shM + (1 - r) * hi * 0.30 * hiM + r * hi * 0.42 * hiM + add;
          g = g + g * sh * 0.62 * shM + (1 - g) * hi * 0.30 * hiM + g * hi * 0.42 * hiM + add;
          b = b + b * sh * 0.62 * shM + (1 - b) * hi * 0.30 * hiM + b * hi * 0.42 * hiM + add;
        }
        r = clamp01(r); g = clamp01(g); b = clamp01(b);
        if (cont) { const cf = 1 + cont * 0.68; r = clamp01((r - 0.5) * cf + 0.5); g = clamp01((g - 0.5) * cf + 0.5); b = clamp01((b - 0.5) * cf + 0.5); }
        r = lutR[lutRGB[(r * 255) | 0]] / 255; g = lutG[lutRGB[(g * 255) | 0]] / 255; b = lutB[lutRGB[(b * 255) | 0]] / 255;
        if (vib || sat) {
          const gl = 0.2126 * r + 0.7152 * g + 0.0722 * b, k = Math.max(0, 1 + vib * (1 - (Math.max(r, g, b) - Math.min(r, g, b))) * 0.75 + sat);
          r = gl + (r - gl) * k; g = gl + (g - gl) * k; b = gl + (b - gl) * k;
        }
        if (fade) { r = fade + r * (1 - fade * 0.85); g = fade + g * (1 - fade * 0.85); b = fade + b * (1 - fade * 0.85); }
        r = clamp01(r); g = clamp01(g); b = clamp01(b);
        if (roll > 0.001) {
          const lw = smoothstep(0.32, 1, 0.2126 * r + 0.7152 * g + 0.0722 * b);
          const rc = (v) => v / (1 + v * roll) * (1 + roll * 0.96);
          r += (rc(r) - r) * lw; g += (rc(g) - g) * lw; b += (rc(b) - b) * lw;
        }
        if (chem === 1) {
          r += ((0.44 + r * 0.38) - r) * 0.35 * vAge * 0.7; g += ((0.44 + g * 0.38) - g) * 0.65 * vAge * 0.7;
          const invL = Math.pow(1 - clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b), 1.3) * vFog * 0.56;
          r += vFogRGB[0] * invL; g += vFogRGB[1] * invL; b += vFogRGB[2] * invL;
        } else if (chem === 9) {
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const k = 0.45 + vAge * 0.55;
          r += (Math.pow(clamp01(r * 0.7 + l * 0.42), 0.82) - r) * k;
          g += (Math.pow(clamp01(g * 0.55 + r * 0.25), 1.25) * 0.86 - g) * k;
          b += (Math.pow(clamp01(b * 0.35 + g * 0.15), 1.85) * 0.48 - b) * k;
        } else if (chem === 8) { r = g = b = clamp01((r * bm[0] + g * bm[1] + b * bm[2]) / bmSum); }
        if (toneAmt > 0.001) {
          const l = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
          r += ((l < 0.5 ? 0.025 + (toneRGB[0] - 0.025) * l * 2 : toneRGB[0] + (0.985 - toneRGB[0]) * (l - 0.5) * 2) - r) * toneAmt;
          g += ((l < 0.5 ? 0.025 + (toneRGB[1] - 0.025) * l * 2 : toneRGB[1] + (0.985 - toneRGB[1]) * (l - 0.5) * 2) - g) * toneAmt;
          b += ((l < 0.5 ? 0.025 + (toneRGB[2] - 0.025) * l * 2 : toneRGB[2] + (0.985 - toneRGB[2]) * (l - 0.5) * 2) - b) * toneAmt;
        }
        const pr0 = r, pg0 = g, pb0 = b;
        const palMapCode = resolvePalMapCode(st.lab);
        const palMix = (st.lab.palMix ?? 100) / 100;
        const palLight = (st.lab.palLight || 0) / 100;
        if (st.lab.colorMode === 'duotone') { const t = clamp01(0.2126*r+0.7152*g+0.0722*b); r = duo0[0]+(duo1[0]-duo0[0])*t; g = duo0[1]+(duo1[1]-duo0[1])*t; b = duo0[2]+(duo1[2]-duo0[2])*t; }
        else if (st.lab.colorMode === 'tritone') { const t = clamp01(0.2126*r+0.7152*g+0.0722*b); const c0 = t<0.5?duo0:duo1, c1 = t<0.5?duo1:duo2, k = t<0.5?t*2:(t-0.5)*2; r = c0[0]+(c1[0]-c0[0])*k; g = c0[1]+(c1[1]-c0[1])*k; b = c0[2]+(c1[2]-c0[2])*k; }
        else if (palCols.length) {
          if (palMapCode === 2) {
            const pos = clamp01(0.2126*r+0.7152*g+0.0722*b) * Math.max(1, palCols.length - 1);
            const i0 = Math.min(palCols.length - 1, Math.floor(pos)), i1 = Math.min(palCols.length - 1, i0 + 1), f = pos - i0;
            r = palCols[i0][0] + (palCols[i1][0] - palCols[i0][0]) * f;
            g = palCols[i0][1] + (palCols[i1][1] - palCols[i0][1]) * f;
            b = palCols[i0][2] + (palCols[i1][2] - palCols[i0][2]) * f;
          } else if (palMapCode === 1) {
            const idx = Math.min(palCols.length - 1, Math.floor(clamp01(0.2126*r+0.7152*g+0.0722*b) * palCols.length));
            r = palCols[idx][0]; g = palCols[idx][1]; b = palCols[idx][2];
          } else {
            let best = 1e9, bc = palCols[0];
            for (let k = 0; k < palCols.length; k++) { const p = palCols[k], dd = (r-p[0])**2+(g-p[1])**2+(b-p[2])**2; if (dd < best) { best = dd; bc = p; } }
            r = bc[0]; g = bc[1]; b = bc[2];
          }
        }
        if (palHue || palSat || palLight) { const h0 = rgb2hslCPU(r, g, b); const rgb = hsl2rgbCPU(h0[0] + palHue, clamp01(h0[1] * (1 + palSat)), clamp01(h0[2] + palLight * 0.42)); r = rgb[0]; g = rgb[1]; b = rgb[2]; }
        if (palInv) { r = 1 - r; g = 1 - g; b = 1 - b; }
        if (palMix < 0.999) { r = pr0 + (r - pr0) * palMix; g = pg0 + (g - pg0) * palMix; b = pb0 + (b - pb0) * palMix; }
        if (vig) { const m = smoothstep(0.32, 0.82, Math.hypot(x / w - 0.5, ny * (h / w)) * 1.414); if (vig < 0) { const k = 1 - m * (-vig) * 0.82; r *= k; g *= k; b *= k; } }
        d[i] = (clamp01(or + (clamp01(r) - or) * mix) * 255 + 0.5) | 0;
        d[i + 1] = (clamp01(og + (clamp01(g) - og) * mix) * 255 + 0.5) | 0;
        d[i + 2] = (clamp01(ob + (clamp01(b) - ob) * mix) * 255 + 0.5) | 0;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return { w, h };
  }

  function renderToCanvas(img, imgId, st, outCanvas, opts = {}) {
    if (!img) return null;
    if (!init()) return renderCPU(img, imgId, st, outCanvas, opts);
    try {

    const poolName = opts.pool === 'thumb' ? 'thumb' : 'main';
    const pool = pools[poolName];
    const isThumb = poolName === 'thumb';
    const isDrag = !!opts.isDrag;
    const maxDim = opts.isExport ? (opts.maxDim || maxTex) : (opts.maxDim || 1800);
    const prep = prepareSource(poolName, img, st.crop, maxDim, imgId, opts.isVideo);
    const w = prep.w, h = prep.h;

    if (!isThumb) {
      if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
    } else if (glCanvas.width < w || glCanvas.height < h) {
      glCanvas.width = Math.max(glCanvas.width, w); glCanvas.height = Math.max(glCanvas.height, h);
    }
    ensurePoolTargets(pool, w, h);

    if (opts.isVideo || prep.key !== pool.srcKey) {
      gl.bindTexture(gl.TEXTURE_2D, pool.srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, prep.canvas);
      if (!opts.isVideo || !pool.autoPal.length) {
        const an = analyzeCanvas(prep.canvas);
        pool.domColor = an.domColor;
        pool.autoPal = an.pixels;
      }
      pool.srcKey = prep.key;
    }

    const cKey = JSON.stringify(st.curve);
    if (cKey !== lastCurveKey) {
      gl.bindTexture(gl.TEXTURE_2D, curveTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, window.buildCurveTextureRGBA(st.curve));
      lastCurveKey = cKey;
    }

    gl.bindVertexArray(vao);
    gl.viewport(0, 0, w, h);

    let readTex = pool.srcTex;
    let baseTex = pool.srcTex;
    let writeIdx = 0;
    const nextTarget = () => { const t = pool.targets[writeIdx]; writeIdx = 1 - writeIdx; return t; };

    // PASS 0: LIGHTROOM GEOMETRY, PERSPECTIVE & LENS CORRECTIONS
    const geomOn = isGeometryActive(st.crop, prep.srcAspect, prep.outAspect);
    if (geomOn) {
      const dst = pool.geomTarget, pr = getProg('geom', GEOMETRY_FS), L = pr.loc;
      const c = st.crop;
      const autoSc = computeAutoConstrainScale(c, prep.srcAspect, prep.outAspect);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.useProgram(pr.p);
      bindTex(0, pool.srcTex); gl.uniform1i(L.uTex, 0);
      gl.uniform1f(L.uSrcAspect, prep.srcAspect);
      gl.uniform1f(L.uOutAspect, prep.outAspect);
      gl.uniform1f(L.uStraighten, ((c.straighten || 0) * Math.PI) / 180);
      gl.uniform1f(L.uPerspV, (c.perspV || 0) / 100);
      gl.uniform1f(L.uPerspH, (c.perspH || 0) / 100);
      gl.uniform1f(L.uSkew, (c.skew || 0) / 100);
      gl.uniform1f(L.uAspectWarp, (c.aspectWarp || 0) / 100);
      gl.uniform1f(L.uScale, (c.scale ?? 100) / 100);
      gl.uniform1f(L.uAutoScale, autoSc);
      gl.uniform1f(L.uOffX, (c.offsetX || 0) / 100);
      gl.uniform1f(L.uOffY, (c.offsetY || 0) / 100);
      gl.uniform1f(L.uDistort, (c.distortion || 0) / 100);
      gl.uniform1f(L.uLensVig, (c.lensVignette || 0) / 100);
      gl.uniform1i(L.uFlipH, c.flipH ? 1 : 0);
      gl.uniform1i(L.uFlipV, c.flipV ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      readTex = dst.tex;
      baseTex = dst.tex;
    }

    // PASS 1: DEVELOP
    {
      const dst = nextTarget(), pr = progs.dev, L = pr.loc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.useProgram(pr.p);
      bindTex(0, readTex); gl.uniform1i(L.uTex, 0);
      bindTex(1, curveTex); gl.uniform1i(L.uCurve, 1);
      gl.uniform1f(L.uExposure, st.light.exposure);
      gl.uniform1f(L.uContrast, st.light.contrast / 100);
      gl.uniform1f(L.uHighlights, st.light.highlights / 100);
      gl.uniform1f(L.uShadows, st.light.shadows / 100);
      gl.uniform1f(L.uWhites, st.light.whites / 100);
      gl.uniform1f(L.uBlacks, st.light.blacks / 100);
      gl.uniform1f(L.uTemp, st.color.temp / 100);
      gl.uniform1f(L.uTint, st.color.tint / 100);
      gl.uniform1f(L.uVibrance, st.color.vibrance / 100);
      gl.uniform1f(L.uSaturation, st.color.saturation / 100);
      gl.uniform1f(L.uDehaze, st.presence.dehaze / 100);
      gl.uniform1f(L.uFade, st.presence.fade / 100);

      let hslOn = 0;
      const hArr = new Float32Array(8), sArr = new Float32Array(8), lArr = new Float32Array(8);
      window.HSL_BANDS.forEach((b, i) => {
        const x = st.hsl[b.key];
        hArr[i] = x.h / 100; sArr[i] = x.s / 100; lArr[i] = x.l / 100;
        if (x.h || x.s || x.l) hslOn = 1;
      });
      gl.uniform1i(L.uHslActive, hslOn);
      gl.uniform1fv(L.uHslH, hArr); gl.uniform1fv(L.uHslS, sArr); gl.uniform1fv(L.uHslL, lArr);

      const gs = st.grade.shadows, gm = st.grade.midtones, gh = st.grade.highlights;
      gl.uniform3f(L.uGradeS, gs.h / 360, gs.s / 100, gs.l / 100);
      gl.uniform3f(L.uGradeM, gm.h / 360, gm.s / 100, gm.l / 100);
      gl.uniform3f(L.uGradeH, gh.h / 360, gh.s / 100, gh.l / 100);
      gl.uniform1f(L.uGradeBalance, st.grade.balance / 100);
      gl.uniform1f(L.uGradeBlend, st.grade.blending / 100);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      readTex = dst.tex;
    }

    // PASS 2: FILM CHEMISTRY
    if (st.film.chem !== 'none' || st.film.rolloff > 0 || st.film.toneAmt > 0) {
      const dst = nextTarget(), pr = getProg('chem', FILM_CHEM_FS), L = pr.loc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.useProgram(pr.p);
      bindTex(0, readTex); gl.uniform1i(L.uTex, 0);
      gl.uniform2f(L.uRes, w, h);
      gl.uniform3f(L.uDomColor, pool.domColor[0], pool.domColor[1], pool.domColor[2]);
      gl.uniform1i(L.uChem, CHEM_MAP[st.film.chem] || 0);
      gl.uniform1f(L.uRolloff, st.film.rolloff / 100);
      const bm = st.film.bwMix || [30, 59, 11];
      gl.uniform3f(L.uBwMix, bm[0], bm[1], bm[2]);
      gl.uniform1f(L.uToneAmt, st.film.toneAmt / 100);
      const tc = window.hexToRgb01(st.film.toneColor);
      gl.uniform3f(L.uToneColor, tc[0], tc[1], tc[2]);
      gl.uniform1f(L.uVAge, st.film.vencidoAge / 100);
      gl.uniform1f(L.uVFog, st.film.vencidoFog / 100);
      gl.uniform1f(L.uVMottle, st.film.vencidoMottle / 100);
      gl.uniform1f(L.uVLeak, st.film.vencidoLeak / 100);
      gl.uniform1f(L.uVSeed, st.film.vencidoSeed || 1);
      gl.uniform1i(L.uVLayer, st.film.vencidoLayer ?? 3);
      const vt = window.hexToRgb01(st.film.vencidoTint);
      gl.uniform3f(L.uVTint, vt[0], vt[1], vt[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      readTex = dst.tex;
    }

    // PASS 3: OPTICS
    const o = st.optics;
    const optActive = st.presence.clarity !== 0 || st.presence.sharpen > 0 || o.halation > 0 ||
      o.bloom > 0 || o.orton > 0 || o.anamorphic > 0 || o.vignette !== 0 || o.chroma > 0 ||
      o.leak > 0 || o.flash > 0 || o.grain > 0;
    if (optActive) {
      const dst = nextTarget(), pr = getProg('opt', OPTICS_FS), L = pr.loc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.useProgram(pr.p);
      bindTex(0, readTex); gl.uniform1i(L.uTex, 0);
      gl.uniform2f(L.uRes, w, h);
      const skipHeavy = isThumb || isDrag;
      gl.uniform1f(L.uClarity, skipHeavy ? 0 : st.presence.clarity / 100);
      gl.uniform1f(L.uSharpen, skipHeavy ? 0 : st.presence.sharpen / 100);
      gl.uniform1f(L.uHalation, isDrag ? 0 : o.halation / 100);
      const hc = window.hexToRgb01(o.halationColor);
      gl.uniform3f(L.uHalColor, hc[0], hc[1], hc[2]);
      gl.uniform1f(L.uBloom, isDrag ? 0 : o.bloom / 100);
      gl.uniform1f(L.uOrton, isDrag ? 0 : o.orton / 100);
      gl.uniform1f(L.uAnamorphic, skipHeavy ? 0 : o.anamorphic / 100);
      gl.uniform1f(L.uVignette, o.vignette / 100);
      gl.uniform1f(L.uVigMid, o.vigMidpoint / 100);
      gl.uniform1f(L.uVigFeather, o.vigFeather / 100);
      gl.uniform1f(L.uChroma, skipHeavy ? 0 : o.chroma / 100);
      gl.uniform1f(L.uFlash, o.flash / 100);
      gl.uniform1f(L.uLeak, o.leak / 100);
      gl.uniform1f(L.uLeakAngle, o.leakAngle || 35);
      const lc = window.hexToRgb01(o.leakColor);
      gl.uniform3f(L.uLeakColor, lc[0], lc[1], lc[2]);
      gl.uniform1f(L.uGrain, skipHeavy ? 0 : o.grain / 100);
      gl.uniform1f(L.uGrainSize, (o.grainSize / 100) * 1.25 * (opts.grainUnit || 1));
      gl.uniform1f(L.uGrainRough, o.grainRough / 100);
      gl.uniform1i(L.uGrainMono, o.grainMono ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      readTex = dst.tex;
    }

    // PASS 4: CREATIVE LAB (Colors, Palette, Recoloring, Pixel/Dither, 12 Wild Textures)
    const lb = st.lab;
    const labActive = lb.pixelSize > 1 || lb.ditherMode !== 'none' || lb.fxId !== 'none' ||
      lb.colorMode !== 'all' || lb.palHue !== 0 || lb.palSat !== 0 || (lb.palLight || 0) !== 0 || lb.palInvert;
    if (labActive) {
      const dst = nextTarget(), pr = getProg('cre', CREATIVE_FS), L = pr.loc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.useProgram(pr.p);
      bindTex(0, readTex); gl.uniform1i(L.uTex, 0);

      let cMode = 0, pCount = 0, qSteps = [5, 6, 5];
      const reqNum = parseInt(lb.colorMode, 10) || 0;
      if (lb.colorMode === 'duotone') cMode = 2;
      else if (lb.colorMode === 'tritone') cMode = 3;
      else if (lb.colorMode !== 'all') {
        if (lb.paletteId === 'auto' && reqNum > 32) {
          cMode = 4;
          qSteps = QUANT_STEPS[reqNum] || [5, 6, 5];
        } else {
          cMode = 1;
          const customKey = lb.paletteId === 'custom' ? (lb.customPal || []).join(',') : '';
          const pKey = `${pool.srcKey}|${lb.colorMode}|${lb.paletteId}|${customKey}`;
          const cols = resolvePaletteColors(lb, pool.autoPal);
          pCount = Math.min(32, cols.length);
          if (pKey !== lastPalKey && pCount > 0) {
            const buf = new Uint8Array(32 * 4);
            for (let i = 0; i < pCount; i++) {
              buf[i * 4 + 0] = cols[i][0]; buf[i * 4 + 1] = cols[i][1]; buf[i * 4 + 2] = cols[i][2]; buf[i * 4 + 3] = 255;
            }
            bindTex(1, palTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 32, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            lastPalKey = pKey;
          }
        }
      }
      bindTex(0, readTex); gl.uniform1i(L.uTex, 0);
      bindTex(1, palTex); gl.uniform1i(L.uPal, 1);
      gl.uniform2f(L.uRes, w, h);
      gl.uniform1f(L.uPixelSize, lb.pixelSize * (opts.grainUnit || 1));
      gl.uniform1i(L.uDitherMode, DITHER_MAP[lb.ditherMode] || 0);
      gl.uniform1f(L.uDitherStr, lb.ditherStrength / 100);
      gl.uniform1i(L.uColorMode, cMode);
      gl.uniform1i(L.uPalCount, pCount);
      gl.uniform1i(L.uPalMap, resolvePalMapCode(lb));
      gl.uniform1f(L.uPalMix, (lb.palMix ?? 100) / 100);
      gl.uniform1f(L.uPalHue, lb.palHue / 360);
      gl.uniform1f(L.uPalSat, lb.palSat / 100);
      gl.uniform1f(L.uPalLight, (lb.palLight || 0) / 100);
      gl.uniform1i(L.uPalInvert, lb.palInvert ? 1 : 0);
      gl.uniform3f(L.uQuantSteps, qSteps[0], qSteps[1], qSteps[2]);
      const d0 = window.hexToRgb01(lb.duo0), d1 = window.hexToRgb01(lb.duo1), d2 = window.hexToRgb01(lb.duo2);
      gl.uniform3f(L.uDuo0, d0[0], d0[1], d0[2]);
      gl.uniform3f(L.uDuo1, d1[0], d1[1], d1[2]);
      gl.uniform3f(L.uDuo2, d2[0], d2[1], d2[2]);
      gl.uniform1i(L.uFxId, FX_MAP[lb.fxId] || 0);
      gl.uniform1i(L.uFxBlend, FX_BLEND_MAP[lb.fxBlend] || 0);
      gl.uniform1f(L.uFxMix, lb.fxMix / 100);
      gl.uniform1f(L.uFxScale, lb.fxScale / 100);
      gl.uniform1f(L.uFxIntensity, lb.fxIntensity / 100);
      gl.uniform1f(L.uFxParam, (lb.fxParam ?? 50) / 100);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      readTex = dst.tex;
    }

    const sy = isThumb ? (glCanvas.height - h) : 0;

    // If Before/After comparison is active, blit aligned baseTex (with same geometry!) to origCanvas
    if (opts.origCanvas) {
      if (opts.origCanvas.width !== w || opts.origCanvas.height !== h) { opts.origCanvas.width = w; opts.origCanvas.height = h; }
      if (geomOn) {
        const pr = progs.blit, L = pr.loc;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.useProgram(pr.p);
        bindTex(0, baseTex); gl.uniform1i(L.uOrig, 0);
        bindTex(1, baseTex); gl.uniform1i(L.uFinal, 1);
        gl.uniform1f(L.uMix, 0.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const origCtx = opts.origCanvas.getContext('2d');
        origCtx.imageSmoothingEnabled = false;
        origCtx.drawImage(glCanvas, 0, sy, w, h, 0, 0, w, h);
      } else {
        opts.origCanvas.getContext('2d').drawImage(prep.canvas, 0, 0, w, h);
      }
    }

    // PASS 5: BLIT + MIX (using geometry-aligned baseTex so preset mix never ghosts!)
    {
      const pr = progs.blit, L = pr.loc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(pr.p);
      bindTex(0, baseTex); gl.uniform1i(L.uOrig, 0);
      bindTex(1, readTex); gl.uniform1i(L.uFinal, 1);
      gl.uniform1f(L.uMix, (st.preset.mix ?? 100) / 100);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    if (outCanvas.width !== w || outCanvas.height !== h) { outCanvas.width = w; outCanvas.height = h; }
    const octx = outCanvas.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(glCanvas, 0, sy, w, h, 0, 0, w, h);

    return { w, h };
    } catch (e) {
      console.warn('[Pixelar Studio] Fallback GPU->CPU:', e);
      ok = false; failed = true;
      return renderCPU(img, imgId, st, outCanvas, opts);
    }
  }

  // Lightweight 96x64 Histogram
  const histScratch = document.createElement('canvas');
  histScratch.width = 96; histScratch.height = 64;
  const histCtx = histScratch.getContext('2d', { willReadFrequently: true });

  function computeHistogram(srcCanvas, targetCanvas, clipLeftEl, clipRightEl) {
    if (!srcCanvas || !srcCanvas.width || !targetCanvas) return;
    histCtx.drawImage(srcCanvas, 0, 0, 96, 64);
    const d = histCtx.getImageData(0, 0, 96, 64).data;
    const R = new Uint32Array(256), G = new Uint32Array(256), B = new Uint32Array(256), L = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      R[r]++; G[g]++; B[b]++; L[(r * 54 + g * 183 + b * 19) >> 8]++;
    }
    let mx = 1;
    for (let i = 4; i < 252; i++) { if (R[i] > mx) mx = R[i]; if (G[i] > mx) mx = G[i]; if (B[i] > mx) mx = B[i]; }
    const cw = targetCanvas.width = (targetCanvas.clientWidth || 300) * 2;
    const ch = targetCanvas.height = (targetCanvas.clientHeight || 68) * 2;
    const ctx = targetCanvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let q = 1; q < 4; q++) { ctx.beginPath(); ctx.moveTo((cw * q) / 4, 0); ctx.lineTo((cw * q) / 4, ch); ctx.stroke(); }
    const drawChan = (arr, color) => {
      ctx.beginPath(); ctx.moveTo(0, ch);
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * cw, ch - Math.min(1, arr[i] / (mx * 1.15)) * (ch - 6));
      ctx.lineTo(cw, ch); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    };
    ctx.globalCompositeOperation = 'screen';
    drawChan(R, 'rgba(239,68,68,0.55)'); drawChan(G, 'rgba(34,197,94,0.55)'); drawChan(B, 'rgba(59,130,246,0.62)');
    ctx.globalCompositeOperation = 'source-over';
    drawChan(L, 'rgba(255,255,255,0.16)');
    const total = 96 * 64;
    if (clipLeftEl) clipLeftEl.classList.toggle('warn', (L[0] + L[1]) / total > 0.015);
    if (clipRightEl) clipRightEl.classList.toggle('warn', (L[254] + L[255]) / total > 0.015);
  }

  function exportCubeLUT(st, title = 'Pixelar_Studio_Look') {
    const N = 17, w = N * N, h = N;
    const idCanvas = document.createElement('canvas'); idCanvas.width = w; idCanvas.height = h;
    const idCtx = idCanvas.getContext('2d'), imgData = idCtx.createImageData(w, h), d = imgData.data;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const idx = (g * w + b * N + r) * 4;
      d[idx] = Math.round((r / (N - 1)) * 255); d[idx + 1] = Math.round((g / (N - 1)) * 255); d[idx + 2] = Math.round((b / (N - 1)) * 255); d[idx + 3] = 255;
    }
    idCtx.putImageData(imgData, 0, 0);
    const lutSt = window.deepClone(st);
    lutSt.crop = window.deepClone(window.DEFAULT_STATE.crop);
    lutSt.presence.clarity = 0; lutSt.presence.sharpen = 0;
    lutSt.optics = window.deepClone(window.DEFAULT_STATE.optics);
    lutSt.lab = window.deepClone(window.DEFAULT_STATE.lab);
    if (lutSt.film.chem === 'vencido_viva') { lutSt.film.vencidoMottle = 0; lutSt.film.vencidoLeak = 0; }
    const outC = document.createElement('canvas');
    renderToCanvas(idCanvas, 'lut_' + Date.now(), lutSt, outC, { maxDim: 512, pool: 'thumb', isExport: true });
    const outData = outC.getContext('2d').getImageData(0, 0, w, h).data;
    const lines = [`# Generated by Pixelar Studio`, `TITLE "${title}"`, `LUT_3D_SIZE ${N}`, `DOMAIN_MIN 0.0 0.0 0.0`, `DOMAIN_MAX 1.0 1.0 1.0`];
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const idx = (g * w + b * N + r) * 4;
      lines.push(`${(outData[idx] / 255).toFixed(6)} ${(outData[idx + 1] / 255).toFixed(6)} ${(outData[idx + 2] / 255).toFixed(6)}`);
    }
    return lines.join('\n') + '\n';
  }

  function invalidate() { prepMap.main.key = ''; pools.main.srcKey = ''; lastPalKey = ''; }
  function isGPU() { return init(); }

  return { init, isGPU, renderToCanvas, computeHistogram, exportCubeLUT, invalidate, getActivePaletteHex };
})();

