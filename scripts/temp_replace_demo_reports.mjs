import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/demo/(parent)/admin/reports/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, DEMO_REPORTS_LABELS, PAGE_TITLES } from '$lib/domain/labels';"
);

// Step 2: Page title
c = c.replace(
  '<h2 class="text-lg font-bold">📊 週間レポート</h2>',
  '<h2 class="text-lg font-bold">{DEMO_REPORTS_LABELS.pageTitle}</h2>'
);

// Step 3: Report title with dynamic child name
c = c.replace(
  "<h3 class=\"text-base font-bold\">{formatChildName(report.childName, 'possessive')}週間レポート</h3>",
  "<h3 class=\"text-base font-bold\">{formatChildName(report.childName, 'possessive')}{DEMO_REPORTS_LABELS.reportTitleSuffix}</h3>"
);

// Step 4: Activity stat label
c = c.replace(
  '<p class="text-xs text-[var(--color-feedback-info-text)]">活動</p>',
  '<p class="text-xs text-[var(--color-feedback-info-text)]">{DEMO_REPORTS_LABELS.statActivityLabel}</p>'
);

// Step 5: Activity unit (回)
c = c.replace(
  '<p class="text-[10px] text-[var(--color-feedback-info-text)]">回</p>',
  '<p class="text-[10px] text-[var(--color-feedback-info-text)]">{DEMO_REPORTS_LABELS.statActivityUnit}</p>'
);

// Step 6: Points stat label
c = c.replace(
  '<p class="text-xs text-[var(--color-feedback-warning-text)]">ポイント</p>',
  '<p class="text-xs text-[var(--color-feedback-warning-text)]">{DEMO_REPORTS_LABELS.statPointLabel}</p>'
);

// Step 7: Achievement stat label
c = c.replace(
  '<p class="text-xs text-[var(--color-feedback-success-text)]">実績</p>',
  '<p class="text-xs text-[var(--color-feedback-success-text)]">{DEMO_REPORTS_LABELS.statAchievementLabel}</p>'
);

// Step 8: Achievement unit (獲得)
c = c.replace(
  '<p class="text-[10px] text-[var(--color-feedback-success-text)]">獲得</p>',
  '<p class="text-[10px] text-[var(--color-feedback-success-text)]">{DEMO_REPORTS_LABELS.statAchievementUnit}</p>'
);

// Step 9: Highlight title
c = c.replace(
  '<h4 class="mb-2 text-xs font-bold text-[var(--color-text-secondary)]">🏆 今週のハイライト</h4>',
  '<h4 class="mb-2 text-xs font-bold text-[var(--color-text-secondary)]">{DEMO_REPORTS_LABELS.highlightTitle}</h4>'
);

// Step 10: Category title
c = c.replace(
  '<h4 class="mb-2 text-xs font-bold text-[var(--color-text-secondary)]">📈 カテゴリ別の様子</h4>',
  '<h4 class="mb-2 text-xs font-bold text-[var(--color-text-secondary)]">{DEMO_REPORTS_LABELS.categoryTitle}</h4>'
);

// Step 11: Advice title
c = c.replace(
  '<p class="text-xs font-bold text-[var(--color-feedback-info-text)]">💡 アドバイス</p>',
  '<p class="text-xs font-bold text-[var(--color-feedback-info-text)]">{DEMO_REPORTS_LABELS.adviceTitle}</p>'
);

writeFileSync('src/routes/demo/(parent)/admin/reports/+page.svelte', c, 'utf8');
console.log('Done');
