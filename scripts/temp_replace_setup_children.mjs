import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/setup/children/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, getAgeTierLabel, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, PAGE_TITLES, SETUP_CHILDREN_LABELS, getAgeTierLabel } from '$lib/domain/labels';"
);

// Step 2: Page title
c = c.replace(
  '<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">子供を登録しよう</h2>',
  '<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">{SETUP_CHILDREN_LABELS.pageTitle}</h2>'
);

// Step 3: Page desc
c = c.replace(
  '\tがんばりクエストを使う子供を登録してください（1人以上）。\n</p>',
  '\t{SETUP_CHILDREN_LABELS.pageDesc}\n</p>'
);

// Step 4: Success message
c = c.replace(
  '<SuccessAlert message="子供を登録しました！" />',
  '<SuccessAlert message={SETUP_CHILDREN_LABELS.addSuccessMessage} />'
);

// Step 5: Registered title with count
c = c.replace(
  "\t\t<h3 class=\"text-sm font-bold text-[var(--color-text-secondary)] mb-2\">登録済み（{data.children.length + '人'}）</h3>",
  "\t\t<h3 class=\"text-sm font-bold text-[var(--color-text-secondary)] mb-2\">{SETUP_CHILDREN_LABELS.registeredTitle(data.children.length)}</h3>"
);

// Step 6: Age / mode display
c = c.replace(
  "\t\t\t\t\t\t\t{child.age + '歳'} / {getAgeTierLabel(child.uiMode)}モード",
  "\t\t\t\t\t\t\t{child.age + '歳'} / {getAgeTierLabel(child.uiMode)}{SETUP_CHILDREN_LABELS.ageModeSuffix}"
);

// Step 7: Add form title
c = c.replace(
  '\t<h3 class="text-sm font-bold text-[var(--color-text-secondary)]">子供を追加</h3>',
  '\t<h3 class="text-sm font-bold text-[var(--color-text-secondary)]">{SETUP_CHILDREN_LABELS.addFormTitle}</h3>'
);

// Step 8: Theme color label
c = c.replace(
  '<label for="theme" class="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">テーマカラー</label>',
  '<label for="theme" class="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{SETUP_CHILDREN_LABELS.themeColorLabel}</label>'
);

// Step 9: Pink theme label
c = c.replace(
  '\t\t\t\t\t<span class="text-sm font-medium text-[var(--color-text)]">ピンク</span>',
  '\t\t\t\t\t<span class="text-sm font-medium text-[var(--color-text)]">{SETUP_CHILDREN_LABELS.themePink}</span>'
);

// Step 10: Blue theme label
c = c.replace(
  '\t\t\t\t\t<span class="text-sm font-medium text-[var(--color-text)]">ブルー</span>',
  '\t\t\t\t\t<span class="text-sm font-medium text-[var(--color-text)]">{SETUP_CHILDREN_LABELS.themeBlue}</span>'
);

// Step 11: Submit button states
c = c.replace(
  "\t\t{submitting ? '登録中...' : '追加する'}",
  "\t\t{submitting ? SETUP_CHILDREN_LABELS.submittingLabel : SETUP_CHILDREN_LABELS.addButton}"
);

// Step 12: Next button
c = c.replace(
  '<Button type="submit" variant="primary" size="md" class="w-full">次へ</Button>',
  '<Button type="submit" variant="primary" size="md" class="w-full">{SETUP_CHILDREN_LABELS.nextButton}</Button>'
);

// Step 13: Back to home link
c = c.replace(
  '\t>ホームに戻る</a>',
  '\t>{SETUP_CHILDREN_LABELS.backToHome}</a>'
);

writeFileSync('src/routes/setup/children/+page.svelte', c, 'utf8');
console.log('Done');
