/**
 * tests/unit/scripts/check-admin-bypass-evidence.test.ts (#4348 対象 #3)
 *
 * admin bypass merge の Self-Review 証跡検出 (ADR-0044 / #1201) の判定 test。
 *
 * ## 何を守るか
 *
 * 旧実装は `EVIDENCE_MARKER_PATTERNS.some((re) => re.test(body))` で本文全体を見ていた。
 * `^##` の行頭アンカーはあるが、**HTML コメント / fenced code block の中の見出し**を
 * 区別できない。本 script 自身が投稿する追記依頼コメントは証跡テンプレートを
 * ```markdown fence で囲んで提示するため、**bot コメントを PR 本文に貼り戻すだけで
 * 「証跡あり」**になり、証跡を 1 文字も書かずに追跡から外れられた。
 *
 * 判定規律は他の PR body gate と同じ SSOT (`scripts/lib/ci/pr-body-sections.mjs`) に揃える。
 */

import { describe, expect, it } from 'vitest';
import {
	EVIDENCE_MARKER_PATTERNS,
	hasEvidenceSection,
	isBotAuthored,
} from '../../../scripts/check-admin-bypass-evidence.mjs';

/** bot (`postMissingEvidenceComment`) が投稿する追記依頼コメントの実物と同型。 */
const BOT_COMMENT_PASTED_INTO_BODY = [
	'<!-- admin-bypass-evidence-check -->',
	'## 🔍 admin bypass merge — Self-Review 証跡の追記依頼 (ADR-0044)',
	'',
	'以下のテンプレートを PR 本文末尾に追記してください（事後追記で構いません）:',
	'',
	'```markdown',
	'## Self-Review 証跡 (admin bypass)',
	'',
	'### 確認した観点',
	'- [ ] Issue AC 全項目突合',
	'```',
].join('\n');

const REAL_EVIDENCE = [
	'## 変更内容',
	'',
	'admin bypass で merge したため証跡を残す。',
	'',
	'## Self-Review 証跡 (admin bypass)',
	'',
	'### 確認した観点',
	'- [x] Issue AC 全項目突合 — `npx vitest run tests/unit/` 全 PASS',
].join('\n');

describe('hasEvidenceSection — 証跡セクションは「宣言」として書かれていることを要求する', () => {
	it('本文に見出しとして書かれていれば証跡ありと判定する', () => {
		expect(hasEvidenceSection(REAL_EVIDENCE)).toBe(true);
	});

	it('別表記 `## Self-Review (admin bypass)` も証跡ありと判定する', () => {
		expect(hasEvidenceSection('## Self-Review (admin bypass)\n\n- [x] AC 突合')).toBe(true);
	});

	it('bot の追記依頼コメントを本文に貼り戻しただけでは証跡と認めない', () => {
		// 旧実装ではここが true になり、証跡を書かずに追跡から外れられた。
		expect(hasEvidenceSection(BOT_COMMENT_PASTED_INTO_BODY)).toBe(false);
	});

	it('HTML コメント内の見出しは証跡と認めない（レンダリング後の本文に出ない）', () => {
		const body = ['## 変更内容', '<!--', '## Self-Review 証跡', '-->'].join('\n');
		expect(hasEvidenceSection(body)).toBe(false);
	});

	it('code fence 内の見出し（書式の例示）は証跡と認めない', () => {
		const body = ['## 変更内容', '', '```markdown', '## Self-Review 証跡', '```'].join('\n');
		expect(hasEvidenceSection(body)).toBe(false);
	});

	it('body が空 / null なら証跡なし', () => {
		expect(hasEvidenceSection('')).toBe(false);
		expect(hasEvidenceSection(null)).toBe(false);
	});

	it('marker パターンは 2 種類（表記ゆれ）を維持する', () => {
		expect(EVIDENCE_MARKER_PATTERNS).toHaveLength(2);
	});
});

describe('import しても process が落ちない（判定を test から呼べる）', () => {
	// 旧実装は module top-level で `REPO` 未設定なら `process.exit(2)` していたため、
	// import した時点で vitest ごと落ちて判定の回帰を固定できなかった。
	it('REPO 未設定でも import 済みの判定関数が呼べる', () => {
		expect(process.env.REPO).toBeUndefined();
		expect(typeof hasEvidenceSection).toBe('function');
	});
});

// ---------------------------------------------------------------------------
// #4612: bot 判定は login 文字列ではなくアカウント種別 (`is_bot`) で行う
//
// 旧実装は `login.endsWith('[bot]')` で、GitHub App が作成した PR (`app/<slug>`) を
// 1 件も拾えなかった。統合 PR (App 作成) が毎回 exempt から漏れ、証跡の追記依頼コメントが
// 投稿され続けた (実測: 2026-08-13 16:05Z に PR #4534 へ投稿)。
// `is_bot` は gh が GraphQL `author.__typename == 'Bot'` を写した値で、利用者側で騙れない。
// ---------------------------------------------------------------------------

describe('isBotAuthored — App 作成 PR を拾い、値が無ければ exempt しない', () => {
	// 実測値 (`gh pr list --json author`、2026-08-13)。
	it.each([
		['app/ganbari-quest-integrator', true],
		['app/dependabot', true],
	])('App actor %s は bot と判定する (実測: is_bot=true)', (login, expected) => {
		expect(isBotAuthored({ author: { login, is_bot: true } })).toBe(expected);
	});

	it('人間の作成者は bot ではない', () => {
		expect(isBotAuthored({ author: { login: 'Takenori-Kusaka', is_bot: false } })).toBe(false);
	});

	it('is_bot が無い / author 自体が無いときは exempt しない (fail-closed)', () => {
		// `[bot]` を含む login を騙っても、種別が取れなければ exempt しない。
		expect(isBotAuthored({ author: { login: 'not-really-a[bot]' } })).toBe(false);
		expect(isBotAuthored({ author: null })).toBe(false);
		expect(isBotAuthored({})).toBe(false);
	});

	it('is_bot が boolean でない値 (文字列 "true" 等) では exempt しない', () => {
		expect(isBotAuthored({ author: { login: 'x', is_bot: 'true' } })).toBe(false);
		expect(isBotAuthored({ author: { login: 'x', is_bot: 1 } })).toBe(false);
	});
});
