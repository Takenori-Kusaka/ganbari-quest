import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/(parent)/admin/packs/+page.svelte', 'utf8');

// Fix: '件' still in partially imported and activity count lines
// Move '件' into the label constants
c = c.replace(
  '\t\t\t\t\t\t\t\t\t\t{pack.importedCount}/{pack.activityCount}件{PACKS_PAGE_LABELS.partiallyImportedSuffix}',
  '\t\t\t\t\t\t\t\t\t\t{pack.importedCount}/{pack.activityCount}{PACKS_PAGE_LABELS.partiallyImportedSuffix}'
);

c = c.replace(
  "\t\t\t\t\t\t\t\t\t{expandedPack === pack.packId ? '▲' : '▼'} {pack.activityCount}件{PACKS_PAGE_LABELS.activityCountSuffix}",
  "\t\t\t\t\t\t\t\t\t{expandedPack === pack.packId ? '▲' : '▼'} {pack.activityCount}{PACKS_PAGE_LABELS.activityCountSuffix}"
);

writeFileSync('src/routes/(parent)/admin/packs/+page.svelte', c, 'utf8');
console.log('Done');
