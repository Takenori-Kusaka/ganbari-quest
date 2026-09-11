import { redirect } from '@sveltejs/kit';

// #4866 系 QM 監査 (consistency) / PO 差し戻し 2026-09-09:
// `NucLicensePanel.svelte` の「ドキュメント」リンクが `/legal/selfhost` を指しているのに
// route が無く、**保護者が 404 に着地していた** (`src/routes/legal/` には privacy / terms /
// tokushoho しか無い)。セルフホストの説明は LP 側 (`site/selfhost.html`) が実体なので、
// 兄弟 3 route と同じ形でそこへ送る。
//
// リンク側の href を書き換えるのではなくここに route を足したのは、
// ① NUC 版の画面から出る URL が変わらない (既に配布済みの案内・ブックマークが生きる)
// ② 兄弟 3 route と同じ「/legal/* は LP へ 301」という 1 つの規則で読める
// の 2 点。
export function load() {
	redirect(301, 'https://www.ganbari-quest.com/selfhost.html');
}
