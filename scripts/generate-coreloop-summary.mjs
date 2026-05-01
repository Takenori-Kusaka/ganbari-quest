/**
 * scripts/generate-coreloop-summary.mjs (#1787)
 *
 * Core-loop summary 1-shot 画像 (`static/assets/lp/core-loop-summary.png`) を SVG → PNG 変換で生成する。
 *
 * Issue #1787 で「Gemini 生成の 1-shot summary 画像」が求められたが、
 * GEMINI_API_KEY が無い環境でも CI / production で 404 を出さないよう、
 * SVG ベースの確定的な代替実装を本スクリプトに用意する。
 *
 * 後から Gemini で本格生成し直す場合は、`docs/reference/gemini_image_generation_guide.md`
 * §A-1 のブランドスタイルブロック + 本スクリプト先頭コメントの prompt を参照すること。
 *
 * 実行: `node scripts/generate-coreloop-summary.mjs`
 *
 * Gemini 用プロンプト（後日置換時に使用）:
 *   1-shot summary illustration showing the core loop of a children gamification app:
 *   活動 (activity) → 習慣 (habit) → ごほうび (reward).
 *   The brand D3 warrior character at center, with three colored icons orbiting
 *   in a circular flow (blue activity, purple habit, orange reward).
 *   Each icon connected with subtle directional arrows showing clockwise circulation.
 *   Pastel sky-blue radial gradient background.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// site/ (GitHub Pages 配布用) と static/ (アプリ本体) の双方に配置する
//   - site/assets/lp/core-loop-summary.png — LP (site/index.html) から相対参照
//   - static/assets/lp/core-loop-summary.png — アプリ本体・カタログ参照用 (asset-catalog.md)
const OUT_SITE = resolve(ROOT, 'site/assets/lp/core-loop-summary.png');
const OUT_STATIC = resolve(ROOT, 'static/assets/lp/core-loop-summary.png');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" width="480" height="320">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#e8f4ff"/>
      <stop offset="100%" stop-color="#fef9e7"/>
    </radialGradient>
    <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <marker id="arrowBlue" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M 0 0 L 12 6 L 0 12 Z" fill="#5BA3E6"/>
    </marker>
    <marker id="arrowPurple" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M 0 0 L 12 6 L 0 12 Z" fill="#a78bfa"/>
    </marker>
    <marker id="arrowGold" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M 0 0 L 12 6 L 0 12 Z" fill="#FFCC00"/>
    </marker>
  </defs>
  <rect width="480" height="320" rx="16" fill="url(#bg)"/>
  <circle cx="240" cy="160" r="110" fill="none" stroke="#cfe5fa" stroke-width="2" stroke-dasharray="4 6"/>

  <!-- circulating arrows -->
  <path d="M 290 65 A 110 110 0 0 1 320 250" fill="none" stroke="#5BA3E6" stroke-width="3" marker-end="url(#arrowBlue)" stroke-linecap="round"/>
  <path d="M 305 255 A 110 110 0 0 1 165 250" fill="none" stroke="#a78bfa" stroke-width="3" marker-end="url(#arrowPurple)" stroke-linecap="round"/>
  <path d="M 145 245 A 110 110 0 0 1 195 65" fill="none" stroke="#FFCC00" stroke-width="3" marker-end="url(#arrowGold)" stroke-linecap="round"/>

  <!-- center brand emblem (D3 warrior shield, simplified) -->
  <g transform="translate(240,160)">
    <circle r="42" fill="#fff" stroke="#3878B8" stroke-width="3"/>
    <path d="M -22 -18 L 22 -18 L 22 8 L 0 26 L -22 8 Z" fill="#5BA3E6"/>
    <polygon points="0,-12 4,-2 14,-2 6,5 9,15 0,9 -9,15 -6,5 -14,-2 -4,-2" fill="#FFE44D" stroke="#FFCC00" stroke-width="1.2"/>
  </g>

  <!-- L1 activity icon (top, blue) -->
  <g transform="translate(240,55)" filter="url(#softGlow)">
    <circle r="34" fill="#5BA3E6"/>
    <circle r="34" fill="none" stroke="#3878B8" stroke-width="2"/>
    <rect x="-16" y="-16" width="32" height="32" rx="6" fill="#fff" stroke="#3878B8" stroke-width="2"/>
    <path d="M -10 0 L -3 8 L 12 -10" fill="none" stroke="#3878B8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <!-- L2 habit icon (bottom-right, purple) -->
  <g transform="translate(330,250)" filter="url(#softGlow)">
    <circle r="34" fill="#a78bfa"/>
    <circle r="34" fill="none" stroke="#7c3aed" stroke-width="2"/>
    <rect x="-16" y="-14" width="32" height="28" rx="4" fill="#fff" stroke="#7c3aed" stroke-width="2"/>
    <line x1="-16" y1="-6" x2="16" y2="-6" stroke="#7c3aed" stroke-width="2"/>
    <circle cx="-7" cy="3" r="3" fill="#a78bfa"/>
    <circle cx="0" cy="3" r="3" fill="#a78bfa"/>
    <circle cx="7" cy="3" r="3" fill="#fde68a" stroke="#f59e0b" stroke-width="1"/>
    <circle cx="-7" cy="10" r="3" fill="#a78bfa"/>
    <circle cx="0" cy="10" r="3" fill="#a78bfa" opacity="0.4"/>
  </g>

  <!-- L3 reward icon (bottom-left, orange) -->
  <g transform="translate(150,250)" filter="url(#softGlow)">
    <circle r="34" fill="#fb923c"/>
    <circle r="34" fill="none" stroke="#c2410c" stroke-width="2"/>
    <rect x="-16" y="-4" width="32" height="20" rx="2" fill="#fff" stroke="#c2410c" stroke-width="2"/>
    <rect x="-16" y="-12" width="32" height="10" rx="2" fill="#fde68a" stroke="#c2410c" stroke-width="2"/>
    <line x1="0" y1="-12" x2="0" y2="16" stroke="#c2410c" stroke-width="2"/>
    <path d="M -8 -14 Q -6 -22 0 -16 Q 6 -22 8 -14" fill="none" stroke="#c2410c" stroke-width="2"/>
  </g>

  <g font-family="system-ui, -apple-system, 'Hiragino Sans', sans-serif" text-anchor="middle">
    <text x="240" y="105" font-size="13" font-weight="700" fill="#3878B8">活動</text>
    <text x="332" y="298" font-size="13" font-weight="700" fill="#7c3aed">習慣</text>
    <text x="148" y="298" font-size="13" font-weight="700" fill="#c2410c">ごほうび</text>
  </g>
</svg>`;

for (const out of [OUT_SITE, OUT_STATIC]) {
	mkdirSync(dirname(out), { recursive: true });
	await sharp(Buffer.from(svg)).resize(960, 640).png({ compressionLevel: 9 }).toFile(out);
	console.log('[generate-coreloop-summary] wrote', out);
}
