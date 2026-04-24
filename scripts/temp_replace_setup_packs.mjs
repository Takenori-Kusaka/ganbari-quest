import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/setup/packs/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, PAGE_TITLES, SETUP_PACKS_LABELS } from '$lib/domain/labels';"
);

// Step 2: Page title
c = c.replace(
  '<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">かつどうパックをえらぼう</h2>',
  '<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">{SETUP_PACKS_LABELS.pageTitle}</h2>'
);

// Step 3: Page desc
c = c.replace(
  '\tお子さまの年齢にあわせた活動セットを選んでください。あとから追加・変更できます。\n</p>',
  '\t{SETUP_PACKS_LABELS.pageDesc}\n</p>'
);

// Step 4: Recommended badge
c = c.replace(
  '\t\t\t\t\t\tおすすめ\n\t\t\t\t\t</span>',
  '\t\t\t\t\t\t{SETUP_PACKS_LABELS.recommendedBadge}\n\t\t\t\t\t</span>'
);

// Step 5: Auto add option
c = c.replace(
  '<span class="text-sm text-[var(--color-text)]">おすすめパックを自動で追加してすすむ</span>',
  '<span class="text-sm text-[var(--color-text)]">{SETUP_PACKS_LABELS.autoAddOption}</span>'
);

// Step 6: Back button
c = c.replace(
  '\t\t\t&larr; もどる\n\t\t</a>',
  '\t\t\t&larr; {SETUP_PACKS_LABELS.backButton}\n\t\t</a>'
);

// Step 7: Processing / skip next button states
c = c.replace(
  "\t\t\t\t{submitting ? '処理中...' : 'おすすめで次へ'}",
  '\t\t\t\t{submitting ? SETUP_PACKS_LABELS.processingLabel : SETUP_PACKS_LABELS.skipNextButton}'
);

// Step 8: Importing label in else branch
c = c.replace(
  '\t\t\t\t\tインポート中...',
  '\t\t\t\t\t{SETUP_PACKS_LABELS.importingLabel}'
);

// Step 9: Add packs button (dynamic count)
c = c.replace(
  "\t\t\t\t\t{selectedPacks.size + '件'}のパックを追加 &rarr;",
  '\t\t\t\t\t{SETUP_PACKS_LABELS.addPacksButton(selectedPacks.size)} &rarr;'
);

writeFileSync('src/routes/setup/packs/+page.svelte', c, 'utf8');
console.log('Done');
