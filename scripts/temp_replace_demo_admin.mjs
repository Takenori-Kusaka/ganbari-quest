import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/demo/(parent)/admin/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { getPlanLabel } from '$lib/domain/labels';",
  "import { DEMO_ADMIN_HOME_LABELS, getPlanLabel } from '$lib/domain/labels';"
);

// Step 2: aria-label attribute
c = c.replace(
  'role="group" aria-label="デモ用プラン切替"',
  'role="group" aria-label={DEMO_ADMIN_HOME_LABELS.planSwitcherAriaLabel}'
);

// Step 3: Plan switcher label text
c = c.replace(
  '<span class="plan-switcher__label">デモ: プランを切り替えて体験</span>',
  '<span class="plan-switcher__label">{DEMO_ADMIN_HOME_LABELS.planSwitcherLabel}</span>'
);

// Step 4: Free plan button
c = c.replace(
  '\t\t\t>\n\t\t\t\t無料プラン\n\t\t\t</a>',
  '\t\t\t>\n\t\t\t\t{DEMO_ADMIN_HOME_LABELS.freePlanButton}\n\t\t\t</a>'
);

// Step 5: Standard plan button
c = c.replace(
  '\t\t\t>\n\t\t\t\t⭐ スタンダード\n\t\t\t</a>',
  '\t\t\t>\n\t\t\t\t{DEMO_ADMIN_HOME_LABELS.standardPlanButton}\n\t\t\t</a>'
);

// Step 6: Family plan button
c = c.replace(
  '\t\t\t>\n\t\t\t\t⭐⭐ ファミリー\n\t\t\t</a>',
  '\t\t\t>\n\t\t\t\t{DEMO_ADMIN_HOME_LABELS.familyPlanButton}\n\t\t\t</a>'
);

// Step 7: Activity label
c = c.replace(
  '<span class="plan-stats__label">カスタム活動</span>',
  '<span class="plan-stats__label">{DEMO_ADMIN_HOME_LABELS.statsActivityLabel}</span>'
);

// Step 8: Child label
c = c.replace(
  '<span class="plan-stats__label">こども</span>',
  '<span class="plan-stats__label">{DEMO_ADMIN_HOME_LABELS.statsChildLabel}</span>'
);

// Step 9: Retention label
c = c.replace(
  '<span class="plan-stats__label">データ保持</span>',
  '<span class="plan-stats__label">{DEMO_ADMIN_HOME_LABELS.statsRetentionLabel}</span>'
);

// Step 10: Trial CTA title
c = c.replace(
  '<p class="demo-trial-cta__title">7日間の無料体験</p>',
  '<p class="demo-trial-cta__title">{DEMO_ADMIN_HOME_LABELS.trialCtaTitle}</p>'
);

// Step 11: Trial CTA desc
c = c.replace(
  '\t\t\t\t\tスタンダードプランの全機能を7日間無料で体験できます。\n\t\t\t\t</p>',
  '\t\t\t\t\t{DEMO_ADMIN_HOME_LABELS.trialCtaDesc}\n\t\t\t\t</p>'
);

// Step 12: Trial CTA button
c = c.replace(
  '\t\t\t\tプランを見る\n\t\t\t</a>',
  '\t\t\t\t{DEMO_ADMIN_HOME_LABELS.trialCtaButton}\n\t\t\t</a>'
);

writeFileSync('src/routes/demo/(parent)/admin/+page.svelte', c, 'utf8');
console.log('Done');
