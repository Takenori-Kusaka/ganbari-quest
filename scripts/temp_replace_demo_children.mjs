import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/demo/(parent)/admin/children/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES, getAgeTierLabel } from '$lib/domain/labels';",
  "import { ADMIN_CHILDREN_LABELS, APP_LABELS, PAGE_TITLES, getAgeTierLabel } from '$lib/domain/labels';"
);

// Step 2: Add child button (4-tab depth)
c = c.replace(
  '\t\t\t\t+ こどもを追加\n\t\t\t</Button>',
  '\t\t\t\t{ADMIN_CHILDREN_LABELS.addButton}\n\t\t\t</Button>'
);

// Step 3: Back to list button (4-tab depth)
c = c.replace(
  '\t\t\t\t← 一覧に戻る\n\t\t\t</Button>',
  '\t\t\t\t{ADMIN_CHILDREN_LABELS.backToList}\n\t\t\t</Button>'
);

// Step 4: Age stat label
c = c.replace(
  '<p class="text-xs text-[var(--color-text-muted)]">年齢</p>',
  '<p class="text-xs text-[var(--color-text-muted)]">{ADMIN_CHILDREN_LABELS.statAgeLabel}</p>'
);

// Step 5: Age tier stat label
c = c.replace(
  '<p class="text-xs text-[var(--color-text-muted)]">年齢区分</p>',
  '<p class="text-xs text-[var(--color-text-muted)]">{ADMIN_CHILDREN_LABELS.statAgeTierLabel}</p>'
);

// Step 6: Balance stat label (dynamic prefix)
c = c.replace(
  '<p class="text-xs text-[var(--color-text-muted)]">{unit}残高</p>',
  '<p class="text-xs text-[var(--color-text-muted)]">{unit}{ADMIN_CHILDREN_LABELS.statBalanceSuffix}</p>'
);

// Step 7: Level stat label
c = c.replace(
  '<p class="text-xs text-[var(--color-text-muted)]">レベル</p>',
  '<p class="text-xs text-[var(--color-text-muted)]">{ADMIN_CHILDREN_LABELS.statLevelLabel}</p>'
);

// Step 8: Status tab empty
c = c.replace(
  '<p class="text-sm">ステータス詳細は登録後にご覧いただけます</p>',
  '<p class="text-sm">{ADMIN_CHILDREN_LABELS.statusTabEmpty}</p>'
);

// Step 9: Logs tab empty
c = c.replace(
  '<p class="text-sm">活動ログは登録後にご覧いただけます</p>',
  '<p class="text-sm">{ADMIN_CHILDREN_LABELS.logsTabEmpty}</p>'
);

// Step 10: Achievements tab empty
c = c.replace(
  '<p class="text-sm">実績一覧は登録後にご覧いただけます</p>',
  '<p class="text-sm">{ADMIN_CHILDREN_LABELS.achievementsTabEmpty}</p>'
);

// Step 11: Voice tab empty
c = c.replace(
  '<p class="text-sm">おうえんボイスは登録後にご利用いただけます</p>',
  '<p class="text-sm">{ADMIN_CHILDREN_LABELS.voiceTabEmpty}</p>'
);

writeFileSync('src/routes/demo/(parent)/admin/children/+page.svelte', c, 'utf8');
console.log('Done');
