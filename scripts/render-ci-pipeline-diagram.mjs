#!/usr/bin/env node

// scripts/render-ci-pipeline-diagram.mjs
// LP デプロイパイプライン図 (Mermaid) を PNG にレンダして docs/screenshots/1157-lp-ss-pipeline/ に保存する
// 用途: PR #1184 (fix/1157) の screenshot-check 要件充足 (UI 変更なしの CI 構造変更 PR)
//
// 使用法: node scripts/render-ci-pipeline-diagram.mjs

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUTPUT_DIR = path.resolve('docs/screenshots/1157-lp-ss-pipeline');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

const MERMAID_SRC = `flowchart TD
    A[push to main] --> B[.github/workflows/pages.yml 起動]
    B --> C[checkout + npm ci]
    C --> D[Playwright install cache]
    D --> E[npm run build]
    E --> F[npm run preview port 5173]
    F --> G[preview 起動待機 60s max]
    G --> H[scripts/capture-hp-screenshots.mjs --webp]
    H -->|BASE_URL=http://localhost:5173| H
    H --> I{site/screenshots/*.webp >= 20 枚?}
    I -->|No| X[workflow FAIL<br/>ADR-0029: 無言で古い画像を残さない]
    I -->|Yes| J[actions/upload-pages-artifact@v5]
    J --> K[actions/deploy-pages@v5]
    K --> L[GitHub Pages 反映<br/>最新 LP + 最新 SS]

    style A fill:#5ba3e6,stroke:#1d4ed8,color:#fff
    style L fill:#15803d,stroke:#0f5a2e,color:#fff
    style X fill:#dc2626,stroke:#991b1b,color:#fff
    style H fill:#fef3c7,stroke:#b45309
    style I fill:#fffbeb,stroke:#b45309
`;

const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>LP デプロイパイプライン - CI Flow</title>
  <style>
    body {
      margin: 0;
      padding: 40px;
      font-family: system-ui, sans-serif;
      background: #ffffff;
    }
    h1 {
      font-size: 20px;
      margin: 0 0 8px 0;
      color: #2d2d2d;
    }
    .subtitle {
      font-size: 13px;
      color: #8b8b8b;
      margin-bottom: 24px;
    }
    #diagram {
      display: flex;
      justify-content: center;
    }
  </style>
</head>
<body>
  <h1>LP デプロイパイプライン — スクリーンショット自動撮影統合 (#1157)</h1>
  <div class="subtitle">
    main push → pages.yml で SvelteKit preview 起動 → capture-hp-screenshots.mjs で撮影 → GitHub Pages デプロイ
  </div>
  <div id="diagram" class="mermaid">${MERMAID_SRC}</div>
  <script type="module">
    import mermaid from '${MERMAID_CDN}';
    mermaid.initialize({ startOnLoad: true, theme: 'default' });
    window.__mermaidReady = false;
    setTimeout(() => { window.__mermaidReady = true; }, 1500);
  </script>
</body>
</html>`;

async function main() {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1200, height: 900 },
		deviceScaleFactor: 2,
	});
	const page = await context.newPage();
	await page.setContent(HTML, { waitUntil: 'networkidle' });
	await page.waitForFunction(() => window.__mermaidReady === true, { timeout: 10000 });
	await page.waitForTimeout(500); // mermaid SVG の描画完了待ち

	const outPath = path.join(OUTPUT_DIR, 'ci-pipeline-flow.png');
	await page.screenshot({ path: outPath, fullPage: true });
	const stat = fs.statSync(outPath);
	console.log(`Generated: ${outPath} (${(stat.size / 1024).toFixed(0)} KB)`);

	await context.close();
	await browser.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
