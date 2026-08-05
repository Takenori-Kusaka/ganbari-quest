// tests/unit/architecture/label-mailbox-routes.test.ts
// #4180 — 宛先 label が用件に縛られて経路が塞がるのを、docs 側で検出する。
//
// ## なぜ test で守るのか
//
// label mailbox は「経路が無いこと」に気づけないのが最大の弱点だった。実際 #4180 では
// **QM 宛の列が丸ごと空**なのに、2 ロールが同日に困るまで誰も気づかなかった。
// 経路マトリクス (§3.3.1) を書いただけでは、次に誰かが表を更新し忘れれば同じことが起きる。
//
// ## 何を守るか (守らないか)
//
// 守る: **マトリクスに空欄が無い** / **語彙表と本文が同じ 9 種を指している** /
//       **各ロールファイルが新語彙を反映している** (docs 間の drift)。
// 守らない: GitHub 上の label の実在。docs は SSOT だが GitHub API を CI で叩かない
//           (ネットワーク依存の test にしない)。label 作成漏れは運用で気づく。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MAILBOX = 'docs/sessions/label-mailbox.md';

/** 宛先 label 6 種 (§3.1)。ここを増減させたら本 test も一緒に直す。 */
const ADDRESS_LABELS = [
	'state:needs-dev',
	'state:needs-qm',
	'state:needs-po',
	'state:needs-audit',
	'state:needs-platform',
	'state:needs-owner',
];

/** 工程 label 3 種 (§3.1)。前提条件を含意する特殊形。 */
const STAGE_LABELS = ['state:dev-done', 'state:qm-blocked', 'state:ready-to-merge'];

describe('#4180 label mailbox の経路', () => {
	const doc = readFileSync(MAILBOX, 'utf8');

	it('語彙は宛先 6 + 工程 3 の 9 種で、すべて §3.1 に載っている', () => {
		const vocabSection = doc.slice(doc.indexOf('### §3.1 label 語彙'), doc.indexOf('### §3.1.1'));
		for (const label of [...ADDRESS_LABELS, ...STAGE_LABELS]) {
			expect(vocabSection, `${label} が §3.1 の語彙表にありません`).toContain(label);
		}
		// 見出しに件数を書いている以上、件数と中身がズレたら落とす
		expect(vocabSection).toContain('9 種');
	});

	it('経路マトリクスに空欄がない (空欄 = 経路の欠落)', () => {
		const start = doc.indexOf('### §3.3.1 経路マトリクス');
		expect(start, '経路マトリクスの節が見つかりません').toBeGreaterThan(-1);
		const section = doc.slice(start, doc.indexOf('### §3.3.2'));

		// | **PO** | — | `needs-dev` | ... の行だけを取る (ヘッダ / 区切り行は除く)
		const rows = section
			.split('\n')
			.filter((l) => l.trim().startsWith('| **') && l.includes('|'))
			.map((l) =>
				l
					.trim()
					.replace(/^\|/, '')
					.replace(/\|$/, '')
					.split('|')
					.map((c) => c.trim()),
			);

		expect(rows.length, '経路マトリクスの行が 6 ロール分ありません').toBe(6);

		const empty: string[] = [];
		for (const row of rows) {
			const from = row[0];
			// 先頭列は from ロール名。以降 6 列が to。自分宛は「—」
			for (let i = 1; i < row.length; i++) {
				const cell = row[i];
				if (cell === '' || cell === '無し' || cell === '**無し**') {
					empty.push(`${from} 列${i}`);
				}
			}
		}
		expect(
			empty,
			`経路マトリクスに空欄があります (そこは mention に退化しています): ${empty.join(', ')}`,
		).toEqual([]);
	});

	it('needs-qm の復路が遷移表にある (答えたら元に戻す)', () => {
		const transition = doc.slice(doc.indexOf('### §3.1.1'), doc.indexOf('### §3.1.2'));
		expect(transition).toContain('state:needs-qm');
		// 「答えたら問い合わせ元に戻す」が無いと #4149 が問い合わせ側で再発する
		expect(transition).toContain('問い合わせ元の state に戻す');
	});

	it('status:* 軸の権限が定義されている', () => {
		expect(doc).toContain('`status:*` 軸の権限');
		expect(doc).toContain('status:on-hold');
	});

	it('PO cron が on-hold 陳腐化と 1 軸 2 値を検出する', () => {
		const cron = doc.slice(doc.indexOf('### PO セッション用'), doc.indexOf('### 監査セッション用'));
		expect(cron, 'on-hold 陳腐化の検出が PO cron にありません').toContain('STALE-HOLD');
		expect(cron, '1 軸 2 値の検出が PO cron にありません').toContain('DUP-AXIS');
	});

	// docs 間の drift guard。SSOT を直しても各ロールが知らなければ経路は開かない。
	it.each([
		'docs/sessions/dev-session.md',
		'docs/sessions/qm-session.md',
		'docs/sessions/po-session.md',
		'docs/sessions/audit-team.md',
		'docs/sessions/platform-session.md',
		'docs/sessions/README.md',
	])('%s が needs-qm を反映している', (path) => {
		expect(readFileSync(path, 'utf8')).toContain('needs-qm');
	});
});
