import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/ops/+layout.svelte', 'utf8');

// Step 1: Add import
c = c.replace(
  "import type { Snippet } from 'svelte';",
  "import type { Snippet } from 'svelte';\nimport { OPS_LAYOUT_LABELS } from '$lib/domain/labels';"
);

// Step 2: Header title
c = c.replace(
  '<h1>がんばりクエスト 運営ダッシュボード</h1>',
  '<h1>{OPS_LAYOUT_LABELS.headerTitle}</h1>'
);

// Step 3: Nav items
c = c.replace('<a href="/ops">KPI</a>', '<a href="/ops">{OPS_LAYOUT_LABELS.navKpi}</a>');
c = c.replace('<a href="/ops/revenue">収益</a>', '<a href="/ops/revenue">{OPS_LAYOUT_LABELS.navRevenue}</a>');
c = c.replace('<a href="/ops/business">採算性</a>', '<a href="/ops/business">{OPS_LAYOUT_LABELS.navBusiness}</a>');
c = c.replace('<a href="/ops/costs">費用</a>', '<a href="/ops/costs">{OPS_LAYOUT_LABELS.navCosts}</a>');
c = c.replace('<a href="/ops/license">ライセンス</a>', '<a href="/ops/license">{OPS_LAYOUT_LABELS.navLicense}</a>');
c = c.replace('<a href="/ops/analytics">分析</a>', '<a href="/ops/analytics">{OPS_LAYOUT_LABELS.navAnalytics}</a>');
c = c.replace('<a href="/ops/cohort">コホート</a>', '<a href="/ops/cohort">{OPS_LAYOUT_LABELS.navCohort}</a>');
c = c.replace('<a href="/ops/export">エクスポート</a>', '<a href="/ops/export">{OPS_LAYOUT_LABELS.navExport}</a>');

writeFileSync('src/routes/ops/+layout.svelte', c, 'utf8');
console.log('Done');
