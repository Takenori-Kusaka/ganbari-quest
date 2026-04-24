import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/(child)/[uiMode=uiMode]/(character)/status/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, CHILD_STATUS_LABELS, PAGE_TITLES } from '$lib/domain/labels';"
);

// Step 2: Growth chart heading
c = c.replace(
  '>せいちょうチャート</h2>',
  '>{CHILD_STATUS_LABELS.growthChartTitle}</h2>'
);

// Step 3: Best cat prefix + name + suffix
c = c.replace(
  '\t\t\t\t\t\t💬 {growthBestCat.name}が',
  '\t\t\t\t\t\t{CHILD_STATUS_LABELS.growthBestCatPrefix}{growthBestCat.name}{CHILD_STATUS_LABELS.growthBestCatSuffix}'
);

// Step 4: High growth message
c = c.replace(
  '\t\t\t\t\t\t\tすごくのびたね！',
  '\t\t\t\t\t\t\t{CHILD_STATUS_LABELS.growthHighMessage}'
);

// Step 5: Low growth message
c = c.replace(
  '\t\t\t\t\t\t\tちょっとずつ せいちょうしてるよ！',
  '\t\t\t\t\t\t\t{CHILD_STATUS_LABELS.growthLowMessage}'
);

// Step 6: Stable growth message
c = c.replace(
  '<p class="text-sm font-bold">💬 あんていしてるね！ またがんばろう！</p>',
  '<p class="text-sm font-bold">{CHILD_STATUS_LABELS.growthStableMessage}</p>'
);

// Step 7: Weak cat growth prompt
c = c.replace(
  '\t\t\t\t\t\t🌟 {growthWeakCat.name}にチャレンジすると のびしろがたくさん！',
  '\t\t\t\t\t\t{CHILD_STATUS_LABELS.growthWeakCatPrefix}{growthWeakCat.name}{CHILD_STATUS_LABELS.growthWeakCatSuffix}'
);

// Step 8: Empty status
c = c.replace(
  '<p class="font-bold">ステータスがまだないよ</p>',
  '<p class="font-bold">{CHILD_STATUS_LABELS.emptyStatus}</p>'
);

writeFileSync('src/routes/(child)/[uiMode=uiMode]/(character)/status/+page.svelte', c, 'utf8');
console.log('Done');
