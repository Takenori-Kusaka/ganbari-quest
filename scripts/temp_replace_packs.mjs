import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/(parent)/admin/packs/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, PACKS_PAGE_LABELS, PAGE_TITLES } from '$lib/domain/labels';"
);

// Step 2: Page title
c = c.replace(
  '<h1 class="text-lg font-bold text-[var(--color-text)] mb-1">活動パック</h1>',
  '<h1 class="text-lg font-bold text-[var(--color-text)] mb-1">{PACKS_PAGE_LABELS.pageTitle}</h1>'
);

// Step 3: Page desc
c = c.replace(
  '\t\t年齢に合わせた活動セットをインポートできます。同じ名前の活動は自動的にスキップされます。\n\t</p>',
  '\t\t{PACKS_PAGE_LABELS.pageDesc}\n\t</p>'
);

// Step 4: Recommended badge
c = c.replace(
  '>おすすめ</span>',
  '>{PACKS_PAGE_LABELS.recommendedBadge}</span>'
);

// Step 5: Imported badge
c = c.replace(
  '>インポート済</span>',
  '>{PACKS_PAGE_LABELS.importedBadge}</span>'
);

// Step 6: Partially imported count + label
c = c.replace(
  "\t\t\t\t\t\t\t\t\t\t{pack.importedCount}/{pack.activityCount + '件'} 登録済\n\t\t\t\t\t\t\t\t\t</span>",
  "\t\t\t\t\t\t\t\t\t\t{pack.importedCount}/{pack.activityCount}件{PACKS_PAGE_LABELS.partiallyImportedSuffix}\n\t\t\t\t\t\t\t\t\t</span>"
);

// Step 7: Activity count toggle
c = c.replace(
  "\t\t\t\t\t\t\t\t\t{expandedPack === pack.packId ? '▲' : '▼'} {pack.activityCount + '件'}の活動",
  "\t\t\t\t\t\t\t\t\t{expandedPack === pack.packId ? '▲' : '▼'} {pack.activityCount}件{PACKS_PAGE_LABELS.activityCountSuffix}"
);

// Step 8: Importing state label
c = c.replace(
  '\t\t\t\t\t\t\t\t\t\tインポート中...\n\t\t\t\t\t\t\t\t\t{:else}',
  '\t\t\t\t\t\t\t\t\t\t{PACKS_PAGE_LABELS.importingLabel}\n\t\t\t\t\t\t\t\t\t{:else}'
);

// Step 9: Import button label (dynamic count)
c = c.replace(
  "\t\t\t\t\t\t\t\t\t\t{pack.activityCount - pack.importedCount + '件'}の新しい活動をインポート",
  '\t\t\t\t\t\t\t\t\t\t{PACKS_PAGE_LABELS.importButton(pack.activityCount - pack.importedCount)}'
);

writeFileSync('src/routes/(parent)/admin/packs/+page.svelte', c, 'utf8');
console.log('Done');
