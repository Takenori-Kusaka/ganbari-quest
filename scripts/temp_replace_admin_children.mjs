import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/(parent)/admin/children/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES, getThemeOptions } from '$lib/domain/labels';",
  "import { ADMIN_CHILDREN_PAGE_LABELS, APP_LABELS, PAGE_TITLES, getThemeOptions } from '$lib/domain/labels';"
);

// Step 2: Page heading
c = c.replace(
  '<h2 class="text-lg font-bold">👧 こども管理</h2>',
  '<h2 class="text-lg font-bold">{ADMIN_CHILDREN_PAGE_LABELS.pageTitle}</h2>'
);

// Step 3: Limit banner title
c = c.replace(
  '<p class="children-page__limit-title">こどもの登録上限に達しています</p>',
  '<p class="children-page__limit-title">{ADMIN_CHILDREN_PAGE_LABELS.limitBannerTitle}</p>'
);

// Step 4: Limit banner desc (dynamic content)
c = c.replace(
  "\t\t\t\t\t現在 {childLimit.current + '人'} / 最大 {childLimit.max + '人'}。\n\t\t\t\t</p>",
  '\t\t\t\t\t{ADMIN_CHILDREN_PAGE_LABELS.limitBannerDesc(childLimit.current, childLimit.max ?? 0)}\n\t\t\t\t</p>'
);

// Step 5: Upgrade link
c = c.replace(
  '\t\t\t\t\t🚀 プランをアップグレードする →\n\t\t\t\t</a>',
  '\t\t\t\t\t{ADMIN_CHILDREN_PAGE_LABELS.limitUpgradeLink}\n\t\t\t\t</a>'
);

// Step 6: Toggle button (cancel/add)
c = c.replace(
  "\t\t\t\t{showAddForm ? 'キャンセル' : '+ こどもを追加'}",
  "\t\t\t\t{showAddForm ? ADMIN_CHILDREN_PAGE_LABELS.cancelButton : ADMIN_CHILDREN_PAGE_LABELS.addButton}"
);

// Step 7: Limit reached button
c = c.replace(
  '\t\t\t\t上限に達しています\n\t\t\t</Button>',
  '\t\t\t\t{ADMIN_CHILDREN_PAGE_LABELS.limitReachedButton}\n\t\t\t</Button>'
);

// Step 8: Add form title
c = c.replace(
  '<h3 class="children-page__add-title">こどもを追加</h3>',
  '<h3 class="children-page__add-title">{ADMIN_CHILDREN_PAGE_LABELS.addFormTitle}</h3>'
);

// Step 9: Nickname label
c = c.replace(
  '\t\t\t\t\t\tlabel="ニックネーム"\n\t\t\t\t\t\ttype="text"',
  '\t\t\t\t\t\tlabel={ADMIN_CHILDREN_PAGE_LABELS.nicknameLabel}\n\t\t\t\t\t\ttype="text"'
);

// Step 10: Birthday hint
c = c.replace(
  '\t\t\t\t\t\thint="設定すると年齢が自動計算されます"',
  '\t\t\t\t\t\thint={ADMIN_CHILDREN_PAGE_LABELS.birthdayHint}'
);

// Step 11: Theme color label
c = c.replace(
  '\t\t\t\t\t\tlabel="テーマカラー"',
  '\t\t\t\t\t\tlabel={ADMIN_CHILDREN_PAGE_LABELS.themeColorLabel}'
);

// Step 12: Submit button
c = c.replace(
  '<Button type="submit" variant="success" size="sm">追加する</Button>',
  '<Button type="submit" variant="success" size="sm">{ADMIN_CHILDREN_PAGE_LABELS.addButton}</Button>'
);

writeFileSync('src/routes/(parent)/admin/children/+page.svelte', c, 'utf8');
console.log('Done');
