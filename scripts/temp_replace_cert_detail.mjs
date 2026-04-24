import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/(parent)/admin/certificates/[id]/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import Button from '$lib/ui/primitives/Button.svelte';",
  "import { CERTIFICATE_DETAIL_LABELS, PAGE_TITLES } from '$lib/domain/labels';\nimport Button from '$lib/ui/primitives/Button.svelte';"
);

// Step 2: Page title (svelte:head)
c = c.replace(
  '<title>{data.certificate.title} - がんばり証明書</title>',
  '<title>{data.certificate.title} - {CERTIFICATE_DETAIL_LABELS.pageTitle}</title>'
);

// Step 3: Back link
c = c.replace(
  '>&larr; 一覧に戻る</a>',
  '>&larr; {CERTIFICATE_DETAIL_LABELS.backLink}</a>'
);

// Step 4: Preview title
c = c.replace(
  '<h2 class="text-lg font-bold text-[var(--color-text-primary)]">📜 証明書プレビュー</h2>',
  '<h2 class="text-lg font-bold text-[var(--color-text-primary)]">{CERTIFICATE_DETAIL_LABELS.previewTitle}</h2>'
);

// Step 5: Print button
c = c.replace(
  '\t\t\t\t🖨️ 印刷 / PDF保存\n\t\t\t</Button>',
  '\t\t\t\t{CERTIFICATE_DETAIL_LABELS.printButton}\n\t\t\t</Button>'
);

// Step 6: PDF upgrade note
c = c.replace(
  '<span class="text-xs text-[var(--color-text-tertiary)]">PDF保存はスタンダードプラン以上</span>',
  '<span class="text-xs text-[var(--color-text-tertiary)]">{CERTIFICATE_DETAIL_LABELS.pdfUpgradeNote}</span>'
);

// Step 7: Upgrade link
c = c.replace(
  '"text-xs text-[var(--color-feedback-info-text)] hover:underline">アップグレード</a>',
  '"text-xs text-[var(--color-feedback-info-text)] hover:underline">{CERTIFICATE_DETAIL_LABELS.upgradeLink}</a>'
);

// Step 8: Share card title
c = c.replace(
  '<h3 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">🎉 がんばりカード</h3>',
  '<h3 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">{CERTIFICATE_DETAIL_LABELS.shareCardTitle}</h3>'
);

// Step 9: Share card desc
c = c.replace(
  '<p class="text-xs text-[var(--color-text-muted)] mb-3">達成を画像でダウンロードして、LINEやSNSでシェアできます</p>',
  '<p class="text-xs text-[var(--color-text-muted)] mb-3">{CERTIFICATE_DETAIL_LABELS.shareCardDesc}</p>'
);

// Step 10: Download button
c = c.replace(
  '\t\t\t\t<Button type="button" variant="primary" size="sm" onclick={handleShareDownload}>\n\t\t\t\t\t📥 画像をダウンロード\n\t\t\t\t</Button>',
  '\t\t\t\t<Button type="button" variant="primary" size="sm" onclick={handleShareDownload}>\n\t\t\t\t\t{CERTIFICATE_DETAIL_LABELS.downloadButton}\n\t\t\t\t</Button>'
);

// Step 11: Close button
c = c.replace(
  '\t\t\t\t<Button type="button" variant="outline" size="sm" onclick={() => { showShareCard = false; }}>\n\t\t\t\t\t閉じる\n\t\t\t\t</Button>',
  '\t\t\t\t<Button type="button" variant="outline" size="sm" onclick={() => { showShareCard = false; }}>\n\t\t\t\t\t{CERTIFICATE_DETAIL_LABELS.closeButton}\n\t\t\t\t</Button>'
);

// Step 12: Show share card button
c = c.replace(
  '\t\t\t<Button type="button" variant="outline" size="sm" onclick={() => { showShareCard = true; }}>\n\t\t\t\t🎉 シェアカードを表示\n\t\t\t</Button>',
  '\t\t\t<Button type="button" variant="outline" size="sm" onclick={() => { showShareCard = true; }}>\n\t\t\t\t{CERTIFICATE_DETAIL_LABELS.showShareCardButton}\n\t\t\t</Button>'
);

writeFileSync('src/routes/(parent)/admin/certificates/[id]/+page.svelte', c, 'utf8');
console.log('Done');
