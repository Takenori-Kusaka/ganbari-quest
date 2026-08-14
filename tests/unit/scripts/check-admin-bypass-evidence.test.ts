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
