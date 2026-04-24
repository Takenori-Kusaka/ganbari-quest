import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/demo/(parent)/admin/achievements/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, DEMO_ACHIEVEMENTS_LABELS, PAGE_TITLES } from '$lib/domain/labels';"
);

// Step 2: Page title
c = c.replace(
  '<h2 class="text-lg font-bold">🏅 チャレンジ履歴</h2>',
  '<h2 class="text-lg font-bold">{DEMO_ACHIEVEMENTS_LABELS.pageTitle}</h2>'
);

// Step 3: Page desc
c = c.replace(
  '<p class="text-sm text-[var(--color-text-muted)]">過去に完了したチャレンジの記録です。</p>',
  '<p class="text-sm text-[var(--color-text-muted)]">{DEMO_ACHIEVEMENTS_LABELS.pageDesc}</p>'
);

// Step 4: All cleared badge
c = c.replace(
  '>全員クリア！</span>',
  '>{DEMO_ACHIEVEMENTS_LABELS.allClearedBadge}</span>'
);

// Step 5: Completed badge
c = c.replace(
  '>完了</span>',
  '>{DEMO_ACHIEVEMENTS_LABELS.completedBadge}</span>'
);

// Step 6: Date separator
c = c.replace(
  '· {formatDate(challenge.startDate)} 〜 {formatDate(challenge.endDate)}',
  '· {formatDate(challenge.startDate)} {DEMO_ACHIEVEMENTS_LABELS.dateSeparator} {formatDate(challenge.endDate)}'
);

// Step 7: Target and reward labels
c = c.replace(
  "\t\t\t\t\t· 目標{target.baseTarget + '回'} · 報酬{reward.points}P",
  '\t\t\t\t\t{DEMO_ACHIEVEMENTS_LABELS.targetPrefix}{target.baseTarget}{DEMO_ACHIEVEMENTS_LABELS.targetUnit} {DEMO_ACHIEVEMENTS_LABELS.rewardPrefix}{reward.points}P'
);

writeFileSync('src/routes/demo/(parent)/admin/achievements/+page.svelte', c, 'utf8');
console.log('Done');
