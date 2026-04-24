import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/(parent)/admin/certificates/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, CERTIFICATES_PAGE_LABELS, PAGE_TITLES } from '$lib/domain/labels';"
);

// Step 2: Page title
c = c.replace(
  '<h2 class="text-lg font-bold text-[var(--color-text-primary)]">📜 がんばり証明書</h2>',
  '<h2 class="text-lg font-bold text-[var(--color-text-primary)]">{CERTIFICATES_PAGE_LABELS.pageTitle}</h2>'
);

// Step 3: Back to reports link
c = c.replace(
  '>&larr; レポートへ</a>',
  '>&larr; {CERTIFICATES_PAGE_LABELS.backToReportsLink}</a>'
);

// Step 4: Free plan note (split around embedded anchor)
c = c.replace(
  '\t\t\t\t無料プランでは証明書の閲覧のみ可能です。PDF保存は<a href="/admin/license" class="underline font-medium">スタンダードプラン以上</a>で利用できます。',
  '\t\t\t\t{CERTIFICATES_PAGE_LABELS.freePlanNotePrefix}<a href="/admin/license" class="underline font-medium">{CERTIFICATES_PAGE_LABELS.freePlanNoteLink}</a>{CERTIFICATES_PAGE_LABELS.freePlanNoteSuffix}'
);

// Step 5: Empty state title
c = c.replace(
  '<p class="font-bold mb-1">まだ証明書がありません</p>',
  '<p class="font-bold mb-1">{CERTIFICATES_PAGE_LABELS.emptyTitle}</p>'
);

// Step 6: Empty state desc
c = c.replace(
  '<p class="text-sm">活動を記録すると、マイルストーン達成時に証明書が発行されます</p>',
  '<p class="text-sm">{CERTIFICATES_PAGE_LABELS.emptyDesc}</p>'
);

// Step 7: No children title
c = c.replace(
  '<p class="font-bold">子供が登録されていません</p>',
  '<p class="font-bold">{CERTIFICATES_PAGE_LABELS.noChildrenTitle}</p>'
);

writeFileSync('src/routes/(parent)/admin/certificates/+page.svelte', c, 'utf8');
console.log('Done');
