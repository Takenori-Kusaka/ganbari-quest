import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/demo/+layout.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES, PLAN_SHORT_LABELS, type PlanKey } from '$lib/domain/labels';",
  "import { APP_LABELS, DEMO_LAYOUT_LABELS, PAGE_TITLES, PLAN_SHORT_LABELS, type PlanKey } from '$lib/domain/labels';"
);

// Step 2: Back to HP link
c = c.replace(
  '\t\t<span>HPに戻る</span>',
  '\t\t<span>{DEMO_LAYOUT_LABELS.backToHpLink}</span>'
);

// Step 3: Demo notice
c = c.replace(
  '<span class="flex-1 text-center truncate">これはデモです。データは保存されません。</span>',
  '<span class="flex-1 text-center truncate">{DEMO_LAYOUT_LABELS.demoNotice}</span>'
);

// Step 4: Try real button
c = c.replace(
  '\t\t本番で使ってみる\n\t</a>',
  '\t\t{DEMO_LAYOUT_LABELS.tryRealButton}\n\t</a>'
);

// Step 5: Plan switcher label
c = c.replace(
  '<span class="text-[var(--color-text-muted)]">プラン体験:</span>',
  '<span class="text-[var(--color-text-muted)]">{DEMO_LAYOUT_LABELS.planSwitcherLabel}</span>'
);

// Step 6: Floating CTA title
c = c.replace(
  '<p class="text-sm font-bold text-[var(--color-text-primary)] mb-1">お子さまの ぼうけん、はじめよう！</p>',
  '<p class="text-sm font-bold text-[var(--color-text-primary)] mb-1">{DEMO_LAYOUT_LABELS.floatingCtaTitle}</p>'
);

// Step 7: Floating CTA desc
c = c.replace(
  '<p class="text-xs text-[var(--color-text-muted)] mb-3">7日間無料・いつでもキャンセルOK</p>',
  '<p class="text-xs text-[var(--color-text-muted)] mb-3">{DEMO_LAYOUT_LABELS.floatingCtaDesc}</p>'
);

// Step 8: Floating CTA button
c = c.replace(
  '\t\t\t無料で はじめる →\n\t\t</a>',
  '\t\t\t{DEMO_LAYOUT_LABELS.floatingCtaButton}\n\t\t</a>'
);

writeFileSync('src/routes/demo/+layout.svelte', c, 'utf8');
console.log('Done');
