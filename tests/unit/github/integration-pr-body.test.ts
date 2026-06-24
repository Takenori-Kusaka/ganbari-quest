// Issue #2871 (Phase B/B-3) AC3: develop→main 統合 PR 本文生成 SSOT
// (scripts/integration-pr-body.mjs) の純粋関数を網羅する unit test。
// release PR パターンの統合 PR 本文 (含有 PR 一覧自動注入 + template 骨格差込) を検証する。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	buildBackMergeStatus,
	buildContainedPrTable,
	classifyForContainedList,
	escapeCell,
	extractAreaLabel,
	extractTypeLabel,
	parseArgs,
	renderIntegrationPrBody,
	replaceSectionBody,
} from '../../../scripts/integration-pr-body.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, '../../../.github/INTEGRATION_PR_TEMPLATE.md');
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf8');

describe('classifyForContainedList (#2871 AC3 — 含有 PR 判定)', () => {
	it('feature PR (head=feat/*) は含有対象', () => {
		expect(classifyForContainedList({ headRefName: 'feat/123-x' })).toBe('contained');
	});

	it('fix PR (head=fix/*) は含有対象', () => {
		expect(classifyForContainedList({ headRefName: 'fix/456-y' })).toBe('contained');
	});

	it('統合 PR 自身 (head=develop) は除外', () => {
		expect(classifyForContainedList({ headRefName: 'develop' })).toBe('excluded');
	});

	it('back-merge PR (head=back-merge/*) は除外 (drift 状態で §6 が扱う)', () => {
		expect(classifyForContainedList({ headRefName: 'back-merge/fix-999-x' })).toBe('excluded');
	});

	it('back-merge label 付きは head に関わらず除外', () => {
		expect(classifyForContainedList({ headRefName: 'whatever', labels: ['back-merge'] })).toBe(
			'excluded',
		);
	});

	it('labels が {name} オブジェクト形式でも判定できる (gh --json 形式)', () => {
		expect(
			classifyForContainedList({ headRefName: 'whatever', labels: [{ name: 'back-merge' }] }),
		).toBe('excluded');
	});
});

describe('extractTypeLabel / extractAreaLabel (#2871 AC3)', () => {
	it('type:* label を抽出する', () => {
		expect(extractTypeLabel({ labels: ['priority:high', 'type:feat'] })).toBe('type:feat');
	});

	it('type label が無ければ — を返す', () => {
		expect(extractTypeLabel({ labels: ['priority:high'] })).toBe('—');
	});

	it('area:* label を / 連結する', () => {
		expect(extractAreaLabel({ labels: ['area:admin', 'area:lp'] })).toBe('area:admin / area:lp');
	});

	it('area label が無ければ — を返す', () => {
		expect(extractAreaLabel({ labels: [] })).toBe('—');
	});

	it('{name} オブジェクト形式でも抽出できる', () => {
		expect(extractTypeLabel({ labels: [{ name: 'type:fix' }] })).toBe('type:fix');
	});
});

describe('escapeCell (#2871 AC3 — markdown 安全化)', () => {
	it('pipe をエスケープする (表崩れ防止)', () => {
		expect(escapeCell('a|b')).toBe('a\\|b');
	});

	it('改行を空白に潰す', () => {
		expect(escapeCell('line1\nline2')).toBe('line1 line2');
	});

	it('backslash を先にエスケープする (incomplete-sanitization 防止、CodeQL js/incomplete-sanitization)', () => {
		// backslash を pipe より先に escape しないと \| が \\| になり表崩れ / sanitization bypass の温床になる
		expect(escapeCell('a\\b')).toBe('a\\\\b');
		expect(escapeCell('a\\|b')).toBe('a\\\\\\|b');
	});
});

describe('buildContainedPrTable (#2871 AC3 — 含有 PR 一覧 4 列表)', () => {
	it('feature/fix PR を 4 列表に整形し PR 番号昇順で列挙する', () => {
		const table = buildContainedPrTable([
			{ number: 30, title: 'feat B', headRefName: 'feat/30-b', labels: ['type:feat', 'area:lp'] },
			{ number: 10, title: 'fix A', headRefName: 'fix/10-a', labels: ['type:fix', 'area:admin'] },
		]);
		expect(table).toContain('| PR | title | type label | 対象領域 |');
		// 昇順: #10 が #30 より前
		const idx10 = table.indexOf('#10');
		const idx30 = table.indexOf('#30');
		expect(idx10).toBeGreaterThan(-1);
		expect(idx30).toBeGreaterThan(idx10);
		expect(table).toContain('| #10 | fix A | `type:fix` | `area:admin` |');
		expect(table).toContain('| #30 | feat B | `type:feat` | `area:lp` |');
	});

	it('back-merge / 統合 PR 自身は表から除外する (#2871 AC3)', () => {
		const table = buildContainedPrTable([
			{ number: 10, title: 'feat A', headRefName: 'feat/10-a', labels: ['type:feat'] },
			{ number: 11, title: 'back-merge', headRefName: 'back-merge/fix-9', labels: ['back-merge'] },
			{ number: 12, title: '前回統合 PR', headRefName: 'develop', labels: [] },
		]);
		expect(table).toContain('#10');
		expect(table).not.toContain('#11');
		expect(table).not.toContain('#12');
	});

	it('含有 PR が 0 件でも表 header を維持し空である旨を明示する', () => {
		const table = buildContainedPrTable([]);
		expect(table).toContain('| PR | title | type label | 対象領域 |');
		expect(table).toContain('含有 PR なし');
	});

	it('title 内の pipe で表が崩れない', () => {
		const table = buildContainedPrTable([
			{ number: 1, title: 'a | b', headRefName: 'feat/1', labels: [] },
		]);
		expect(table).toContain('a \\| b');
	});
});

describe('buildBackMergeStatus (#2871 — B-5 drift contract)', () => {
	it('未取込 back-merge PR が 0 件なら「該当なし」を出す', () => {
		const s = buildBackMergeStatus({ backMergePrs: [], driftDays: 2 });
		expect(s).toContain('該当なし');
		expect(s).toContain('`2` 日');
	});

	it('未取込 back-merge PR があれば件数 + 出典 + 取込警告を出す', () => {
		const s = buildBackMergeStatus({
			backMergePrs: [{ number: 99, title: 'hotfix back-merge' }],
			driftDays: 5,
		});
		expect(s).toContain('未取込 1 件');
		expect(s).toContain('#99');
		expect(s).toContain('develop に取り込んでから');
		expect(s).toContain('`5` 日');
	});

	it('drift 日数不明 (null) は「不明」と表記する', () => {
		const s = buildBackMergeStatus({ backMergePrs: [], driftDays: null });
		expect(s).toContain('`不明` 日');
	});
});

describe('replaceSectionBody (#2871 AC3 — template section 差込)', () => {
	it('指定 section のデータ部分のみ差し替え、見出しと説明コメントは保持する', () => {
		const tpl = [
			'## 含有 PR 一覧',
			'',
			'<!-- 説明コメント -->',
			'| 古い | 表 |',
			'',
			'## 次の section',
			'内容',
		].join('\n');
		const out = replaceSectionBody(tpl, '## 含有 PR 一覧', '| 新しい | 表 |');
		expect(out).toContain('## 含有 PR 一覧');
		expect(out).toContain('<!-- 説明コメント -->'); // 説明コメントは保持
		expect(out).toContain('| 新しい | 表 |');
		expect(out).not.toContain('| 古い | 表 |'); // 旧データは消える
		expect(out).toContain('## 次の section'); // 次 section は不変
		expect(out).toContain('内容');
	});

	it('存在しない見出しは無変更 (防御的)', () => {
		const tpl = '## A\n本文';
		expect(replaceSectionBody(tpl, '## 存在しない', 'x')).toBe(tpl);
	});
});

describe('renderIntegrationPrBody (#2871 AC3 — facade、実 template で検証)', () => {
	const prs = [
		{ number: 10, title: 'feat A', headRefName: 'feat/10-a', labels: ['type:feat', 'area:admin'] },
		{ number: 20, title: 'fix B', headRefName: 'fix/20-b', labels: ['type:fix', 'area:lp'] },
		{ number: 21, title: '統合 PR 自身', headRefName: 'develop', labels: [] },
	];

	it('B-1 template の全必須 section を保持する (gate 整合)', () => {
		const body = renderIntegrationPrBody({ template: TEMPLATE, prs, developHead: 'abc1234' });
		for (const heading of [
			'## 統合サマリ',
			'## 含有 PR 一覧',
			'## マージ判定エビデンス表',
			'## 監査 run 結果リンク',
			'## NG 0 件 / カバレッジ宣言',
			'## back-merge / drift 状態',
		]) {
			expect(body).toContain(heading);
		}
	});

	it('含有 PR 一覧を自動注入し、統合 PR 自身は除外する (#2871 AC3 手書きなし)', () => {
		const body = renderIntegrationPrBody({ template: TEMPLATE, prs, developHead: 'abc1234' });
		expect(body).toContain('#10');
		expect(body).toContain('#20');
		expect(body).not.toContain('#21'); // 統合 PR 自身は除外
		expect(body).toContain('自動生成'); // 生成済み注記
	});

	it('統合サマリに develop HEAD と期間を注入する', () => {
		const body = renderIntegrationPrBody({
			template: TEMPLATE,
			prs,
			developHead: 'abc1234',
			sinceDate: '2026-06-10',
			untilDate: '2026-06-16',
		});
		expect(body).toContain('abc1234');
		expect(body).toContain('2026-06-10');
		expect(body).toContain('2026-06-16');
	});

	it('マージ判定エビデンス表 section は B-4 実装後のエビデンス表 + SARIF/attestation 参照を保持する (#2876)', () => {
		const body = renderIntegrationPrBody({ template: TEMPLATE, prs, developHead: 'abc1234' });
		// facade は §3 を差し替えない（B-4 #2876 で template 本体が実エビデンス内容に更新済み）。
		// template の §3 が持つべき具体的文言を検証する（空枠注記の死文ではなく現状を assert）。
		const i3 = body.indexOf('## マージ判定エビデンス表');
		const i4 = body.indexOf('## 監査 run 結果リンク');
		expect(i3).toBeGreaterThan(-1);
		expect(i4).toBeGreaterThan(i3);
		const section3 = body.slice(i3, i4); // §3 本体のみに限定して検証
		// マージ判定エビデンス基準 + advisory(非 block) + SARIF 正規化 + 残 NG 0 件明示
		expect(section3).toContain('マージ判定エビデンス');
		expect(section3).toContain('SARIF 2.1.0');
		expect(section3).toContain('advisory (非 block)');
		expect(section3).toContain('残 NG 0 件');
		expect(section3).toContain('audit-manager');
		// §4 (監査 run 結果リンク) は attestation 参照を持つ（merge 後 in-toto Release predicate）。
		const i5 = body.indexOf('## NG 0 件 / カバレッジ宣言');
		expect(i5).toBeGreaterThan(i4);
		const section4 = body.slice(i4, i5);
		expect(section4).toContain('attestation');
		expect(section4).toContain('in-toto');
		// 旧 B-4 空枠注記「自動生成予定」が §3 に残っていないこと（B-4 で解消済み）。
		expect(section3).not.toContain('自動生成予定');
	});

	it('back-merge / drift 状態を注入する (B-5 contract)', () => {
		const body = renderIntegrationPrBody({
			template: TEMPLATE,
			prs,
			developHead: 'abc1234',
			backMergePrs: [{ number: 77, title: 'hotfix bm' }],
			driftDays: 3,
		});
		expect(body).toContain('未取込 1 件');
		expect(body).toContain('#77');
		expect(body).toContain('`3` 日');
	});

	it('差分ゼロ (含有 PR 0 件) でも本文を生成でき、空である旨を明示する', () => {
		const body = renderIntegrationPrBody({ template: TEMPLATE, prs: [], developHead: 'abc1234' });
		expect(body).toContain('含有 PR なし');
	});
});

describe('parseArgs (#2871 — CLI 引数)', () => {
	it('--key value と --key=value 両形式を解釈する', () => {
		expect(parseArgs(['--template', 'a.md', '--develop-head=abc', '--drift-days', '3'])).toEqual({
			template: 'a.md',
			'develop-head': 'abc',
			'drift-days': '3',
		});
	});
});
