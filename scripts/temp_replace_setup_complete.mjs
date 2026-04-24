import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/setup/complete/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, OYAKAGI_LABELS, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, OYAKAGI_LABELS, PAGE_TITLES, SETUP_COMPLETE_LABELS } from '$lib/domain/labels';"
);

// Step 2: Page title
c = c.replace(
  '<h2 class="text-xl font-bold text-[var(--color-text)] mb-1">ぼうけんのはじまり！</h2>',
  '<h2 class="text-xl font-bold text-[var(--color-text)] mb-1">{SETUP_COMPLETE_LABELS.title}</h2>'
);

// Step 3: Adventure prep desc (line 20 - mixed with formatChildName and <br />)
c = c.replace(
  "\t\t{formatChildName(firstChild?.nickname, 'possessive')}ぼうけんじゅんびが<br />かんりょうしたよ！",
  "\t\t{formatChildName(firstChild?.nickname, 'possessive')}{SETUP_COMPLETE_LABELS.descPart1}<br />{SETUP_COMPLETE_LABELS.descPart2}"
);

// Step 4: Child count unit (inside expression)
c = c.replace(
  "{data.childCount + '人'}",
  "{data.childCount + SETUP_COMPLETE_LABELS.childCountUnit}"
);

// Step 5: Child count label
c = c.replace(
  '<div class="text-[0.625rem] text-[var(--color-text-muted)]">こども</div>\n\t\t</div>\n\t\t{#if data.importedActivities',
  '<div class="text-[0.625rem] text-[var(--color-text-muted)]">{SETUP_COMPLETE_LABELS.childCountLabel}</div>\n\t\t</div>\n\t\t{#if data.importedActivities'
);

// Step 6: Activity count unit
c = c.replace(
  '<div class="text-xl font-extrabold text-[var(--color-brand-800)]">{data.importedActivities}こ</div>',
  '<div class="text-xl font-extrabold text-[var(--color-brand-800)]">{data.importedActivities}{SETUP_COMPLETE_LABELS.activityCountUnit}</div>'
);

// Step 7: Activity count label
c = c.replace(
  '<div class="text-[0.625rem] text-[var(--color-text-muted)]">かつどう</div>',
  '<div class="text-[0.625rem] text-[var(--color-text-muted)]">{SETUP_COMPLETE_LABELS.activityCountLabel}</div>'
);

// Step 8: Next mission label
c = c.replace(
  '<p class="text-[0.625rem] font-bold text-[var(--color-gold-700)] uppercase tracking-wide m-0 mb-1">つぎのミッション</p>',
  '<p class="text-[0.625rem] font-bold text-[var(--color-gold-700)] uppercase tracking-wide m-0 mb-1">{SETUP_COMPLETE_LABELS.nextMissionLabel}</p>'
);

// Step 9: Next mission text
c = c.replace(
  '\t\t\t「きょうの がんばりを 3つ きろくしよう！」\n\t\t</p>',
  '\t\t\t{SETUP_COMPLETE_LABELS.nextMissionText}\n\t\t</p>'
);

// Step 10: CTA primary button
c = c.replace(
  '\t\t\tこどもがめんをひらく\n\t\t</a>',
  '\t\t\t{SETUP_COMPLETE_LABELS.ctaPrimary}\n\t\t</a>'
);

// Step 11: CTA secondary button
c = c.replace(
  '\t\t\tおやのせっていをみる\n\t\t</a>',
  '\t\t\t{SETUP_COMPLETE_LABELS.ctaSecondary}\n\t\t</a>'
);

// Step 12: PIN hint (complex - has dynamic OYAKAGI_LABELS embedded)
c = c.replace(
  '\t\t💡 管理画面の「せってい」から{OYAKAGI_LABELS.name}を変更すると、おやの画面を守れるよ。{OYAKAGI_LABELS.defaultValueHint}',
  '\t\t{SETUP_COMPLETE_LABELS.pinHintPrefix}{OYAKAGI_LABELS.name}{SETUP_COMPLETE_LABELS.pinHintMiddle}{OYAKAGI_LABELS.defaultValueHint}'
);

writeFileSync('src/routes/setup/complete/+page.svelte', c, 'utf8');
console.log('Done');
