import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/(parent)/admin/certificates/[id]/+page.svelte', 'utf8');

// Fix print button at 5-tab depth
c = c.replace(
  '\t\t\t\t\t🖨️ 印刷 / PDF保存\n\t\t\t\t</Button>',
  '\t\t\t\t\t{CERTIFICATE_DETAIL_LABELS.printButton}\n\t\t\t\t</Button>'
);

writeFileSync('src/routes/(parent)/admin/certificates/[id]/+page.svelte', c, 'utf8');
console.log('Done');
