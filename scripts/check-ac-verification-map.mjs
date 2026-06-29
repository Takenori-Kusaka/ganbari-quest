// @ts-check
/**
 * scripts/check-ac-verification-map.mjs — Issue #2945 (Phase A/A-3、親 #2942 / EPIC #2861)
 *
 * `.github/workflows/pr-ac-verification-check.yml`（required context `Verify AC map in PR body`）の
 * 検証ロジックを lane-aware な純粋関数として切り出した SSOT（unit test 可能化、Issue #2945 実装方針）。
 *
 * ## 背景（#2942 / #2945）
 *
 * develop 二層ブランチ戦略（docs/sessions/branch-strategy.md §3〜§5）で 3 レーン
 * （feature→develop 軽量 / develop→main 統合 PR 重量 / fix/*→main hotfix 重量）が併存する。
 * 旧 workflow は base/head（レーン）を見ず、per-PR の単一 Issue AC 前提の「AC 検証マップ」を
 * 全レーンに一律要求していた。統合 PR（複数 PR の束ね・単一 Issue 非紐づけ）は構造的に
 * 「統合 PR 自身の AC」を持たず、含有 PR の AC は develop 取込時点で QM が検証済
 * （audit-team.md §3.4）。この前提ミスマッチを lane 判定で解消する。
 *
 * ## lane 別の検証観点（Issue #2945 が SSOT）
 *
 * - **feature / hotfix lane**: 現行どおり「AC 検証マップ 4 列 + #1539 未完了表記検出」を検証（AC4 回帰ゼロ）。
 * - **integration lane**: per-PR AC マップの代わりに「マージ判定エビデンス表」セクションの存在 +
 *   4 列（含有 PR / 領域 / テスト / 結果）+「残 NG 0 件」明示を検証（audit-team.md §3.5、AC3）。
 *   `<!-- ac-verification-skip -->` 偽装に依存しない正規観点。表が欠落 or 空行で fail する。
 * - **dependabot lane**: 呼び出し側（job-level if）で従来どおり skip 相当（挙動不変、AC6）。
 *   本関数では `shouldSkip()` が dependencies / type:docs / 明示 skip コメントを判定する。
 *
 * ## 検証の本質を減らさない（#2945 no-go）
 *
 * integration lane で AC マップを外す代わりに必ずエビデンス表を要求する（実検証の総量を減らさない）。
 * skip による検証空洞化（required check が「何も見ずに緑」）は禁止。
 *
 * ## SSOT / 関連
 *
 * - lane 判定: scripts/pr-lane.mjs（A-1、actions/pr-lane composite action 経由で workflow から呼ぶ）
 * - 統合 PR エビデンス基準: docs/sessions/audit-team.md §3.5（4 点 + NG 0 件条件）
 * - 関連 ADR: ADR-0038（AC 検証マップ、docs/decisions/0004-review-and-ac-verification.md 統合）/
 *   ADR-0056（self-report 物理強制）/ ADR-0004（AC 検証）
 * - 関連 Issue: #2945 / #2942 / #1165（ADR-0038 原典）/ #1539（未完了表記検出）/ #1808（Dependabot exempt）
 *
 * exit: 0 = PASS / 1 = 検証失敗 / 2 = 引数不足
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 統合 PR の検証で要求する section 見出し（暫定。統合 PR template 確定は Phase B #2871）。 */
export const INTEGRATION_EVIDENCE_SECTION = 'マージ判定エビデンス表';

/** #1539: AC マップ 4 列目（結果/エビデンス列）の未完了表記検出パターン。 */
const TODO_PATTERN = /todo|予定|追加予定|別途|follow[\s-]?up|後で/i;

/**
 * 未完了表記検出の前処理（#3488 false-positive fix → #3488 BLOCK 再修正）。
 * 結果/エビデンス列には「ファイルパス / URL」等の**完了済エビデンス参照**が入り、
 * その識別子トークン内に未完了語が部分一致することがある。
 * 例: `docs/research/2026-06-29-followup-treadmill-root-cause.md` の filename 中 `followup` を
 *     `follow[\s-]?up` が誤検出していた（research doc 添付で AC 完了済なのに gate fail）。
 *
 * **設計方針（過剰除去より false-positive 残存リスクを取る、#3488 BLOCK 教訓）**:
 * 日本語は語間に空白が無いため、「inline code span 全除去」「`/` を含むトークン全除去」のような
 * 広域 strip は、未完了マーカーを囲む code span や `/` 隣接の日本語句ごと cell を空にして
 * #1539（未完了表記検出）を bypass させてしまう（作者が `` `別途follow-upで対応` `` /
 * `別途#3500で対応予定/参照` と書くだけで gate 通過）。
 * よって除去対象は「未完了語と重ならない**明示的な参照トークン**」だけに精密化する:
 *   1. URL（`https?://…`）— 明示参照。日本語の未完了句を含まない
 *   2. 拡張子で終わるファイル名トークン（path 区切り `/` を含んでも 1 トークンとして除去）
 *      — 元 false-positive（`…-root-cause.md` 中の `followup`）はこの rule 単体で解消する
 *
 * inline code span 全除去 / `/` トークン全除去は **撤去**した（散文中の未完了句を巻き込むため）。
 * code span や `/` 隣接に未完了語を置いても #1539 が検出し続ける（負の回帰 test で固定、#3488）。
 *
 * @param {string} cell 結果/エビデンスセルの生テキスト
 * @returns {string} status 検出用に正規化したテキスト
 */
function stripEvidenceReferences(cell) {
	return cell
		.replace(/https?:\/\/[^\s|]+/gi, ' ') // URL（明示参照、未完了語と重ならない）
		.replace(
			/[^\s|]*\.(?:md|mdx|ts|tsx|js|jsx|mjs|cjs|json|svelte|css|scss|html|ya?ml|sh|py|webp|png|svg|txt|csv)\b/gi,
			' ',
		); // 拡張子で終わるファイル名トークン（path 区切り `/` を含んでも全体を 1 トークンとして除去）
}

/** integration lane の「残 NG 0 件」明示を検出するパターン（audit-team.md §3.5 #5）。 */
const NG_ZERO_PATTERN = /残\s*NG\s*(?:合計\s*)?0\s*件|残\s*NG[^\n|]*[:：]?\s*0\b|NG\s*0\s*件/;

/**
 * AC 検証マップの 4 列行を本文から抽出する（共通 util）。
 * ヘッダー行（`| AC 番号 | AC 内容 ...` 等）とセパレーター（`|---|---|`）を除外する。
 *
 * @param {string} body PR 本文
 * @param {number} fromIdx 抽出開始 index（section 見出し以降に限定する用途）
 * @returns {string[]} 4 列のデータ行（生のマークダウン行）
 */
function extractFourColumnRows(body, fromIdx) {
	const section = body.slice(fromIdx);
	return section
		.split('\n')
		.filter((l) => /^\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/.test(l))
		.filter((l) => !/^\|\s*-+\s*\|/.test(l)) // separator
		.filter((l) => !/AC 番号\s*\|\s*AC 内容/.test(l)) // feature lane header
		.filter((l) => !/含有\s*PR\s*\|/.test(l)) // integration lane header（含有 PR | 領域 | …）
		.filter((l) => !/変更（?出典/.test(l)); // integration lane header（変更（出典 PR） | …）
}

/**
 * 行配列から「空欄 / プレースホルダ（<!-- -->）」行を抽出する。
 *
 * @param {string[]} rows 4 列データ行
 * @returns {string[]} 空欄/プレースホルダ行
 */
function findEmptyRows(rows) {
	return rows.filter((row) => {
		const cells = row
			.split('|')
			.slice(1, -1)
			.map((c) => c.trim());
		// js/bad-tag-filter (CodeQL): 改行を含むコメント + `--!>` 終端も検出する
		return cells.some((c) => c === '' || /^<!--[\s\S]*--!?>$/.test(c));
	});
}

/**
 * skip 判定。feature / hotfix lane では label / 明示 skip コメントで skip する。
 * **integration lane では skip を一切認めない（#3071、空洞化防止）**: 誤った type:docs /
 * dependencies label が統合 PR に付いても §3.5 マージ判定エビデンス表の検証を必ず実行する。
 * 呼び出し側 workflow は lane=dependabot を job-level if でも skip する（本関数には非 dependabot のみ到達）。
 *
 * @param {{ body: string; labels: string[]; lane?: string }} input
 * @returns {{ skip: boolean; reason?: string }}
 */
export function shouldSkip({ body, labels, lane }) {
	// integration lane (統合 PR = release/* → main または develop → main) では
	// label / 明示コメントによる skip を無効化する (#3071)。required 緑のまま evidence 検証が空洞化するのを防ぐ。
	if (lane === 'integration') {
		return { skip: false };
	}
	if (labels.includes('type:docs')) {
		return { skip: true, reason: 'type:docs ラベル' };
	}
	if (labels.some((l) => l.includes('dependencies'))) {
		return { skip: true, reason: 'dependencies ラベル（Dependabot exempt）' };
	}
	const skipMatch = body.match(/<!--\s*ac-verification-skip:\s*(.+?)\s*-->/);
	if (skipMatch) {
		return { skip: true, reason: `明示 skip コメント: ${skipMatch[1]}` };
	}
	return { skip: false };
}

/**
 * @typedef {object} AcCheckResult
 * @property {boolean} ok 検証 PASS か
 * @property {'feature'|'integration'|'hotfix'|'dependabot'} lane 判定に使った lane
 * @property {string} [reason] PASS 時の補足 / skip 理由
 * @property {string} [error] FAIL 時のメッセージ（複数行）
 * @property {string[]} [info] 補助ログ行
 */

/**
 * feature / hotfix lane の AC 検証マップ検証（現行ロジックを維持、AC4 回帰ゼロ）。
 *
 * @param {string} body PR 本文
 * @param {'feature'|'hotfix'} lane
 * @returns {AcCheckResult}
 */
export function checkPerPrAcMap(body, lane) {
	const mapHeaderIdx = body.indexOf('AC 検証マップ');
	if (mapHeaderIdx === -1) {
		return {
			ok: false,
			lane,
			error:
				'❌ PR 本文に「AC 検証マップ」セクションが見つかりません (ADR-0038)\n' +
				'PR テンプレートのセクションが削除されています。',
		};
	}

	const rows = extractFourColumnRows(body, mapHeaderIdx);
	const emptyRows = findEmptyRows(rows);
	const info = [`AC map rows found: ${rows.length}, empty/placeholder rows: ${emptyRows.length}`];

	if (rows.length === 0) {
		return {
			ok: false,
			lane,
			info,
			error:
				'❌ AC 検証マップに行が 1 件もありません (ADR-0038)\n\n' +
				'Issue の Acceptance Criteria 1 行ごとに 1 行を埋めてください。\n' +
				'例:\n| AC1 | ログイン後にダッシュボードが表示される | `npx playwright test auth.spec.ts` | PASS |',
		};
	}

	if (emptyRows.length > 0) {
		const details = emptyRows.map((r) => `  ${r.slice(0, 120)}`).join('\n');
		return {
			ok: false,
			lane,
			info,
			error:
				`❌ AC 検証マップに ${emptyRows.length} 件の空欄/プレースホルダ行があります (ADR-0038)\n\n` +
				'「AC 内容」「検証手段」「結果 / エビデンス」の全列を埋めてください。\n' +
				'目視確認のみは不可。機械検証可能なコマンド / ファイルパス / スクリーンショット番号で記入してください。\n\n' +
				`空欄行:\n${details}`,
		};
	}

	// #1539: 4 列目（結果/エビデンス列）に未完了表記が含まれる場合 FAIL
	const todoRows = rows
		.map((row, idx) => {
			const cells = row
				.split('|')
				.slice(1, -1)
				.map((c) => c.trim());
			const evidenceCell = cells[3] ?? '';
			if (TODO_PATTERN.test(stripEvidenceReferences(evidenceCell))) {
				const acId = cells[0] || `行 ${idx + 1}`;
				return { acId, evidenceCell };
			}
			return null;
		})
		.filter(/** @returns {x is {acId: string; evidenceCell: string}} */ (x) => x !== null);

	if (todoRows.length > 0) {
		const details = todoRows
			.map((item) => `  ${item.acId}: 「${item.evidenceCell.slice(0, 80)}」`)
			.join('\n');
		return {
			ok: false,
			lane,
			info,
			error:
				`❌ AC 検証マップの「結果/エビデンス」列に未完了表記が ${todoRows.length} 件あります (#1539)\n\n` +
				'「TODO」「予定」「追加予定」「別途」「follow-up」「後で」は未完了を示します。\n' +
				'全 AC を実際に検証した上で、具体的なエビデンス（PASS / スクリーンショット番号 / コマンド結果）を記入してください。\n\n' +
				`未完了行:\n${details}`,
		};
	}

	return { ok: true, lane, info, reason: 'AC 検証マップ: 全行 埋まっています ✓' };
}

/**
 * integration lane の「マージ判定エビデンス表」検証（AC3）。
 * per-PR AC マップの代わりに以下を要求する（audit-team.md §3.5）:
 *   1. 「マージ判定エビデンス表」section の存在
 *   2. 4 列（含有 PR / 領域 / テスト / 結果）のデータ行が 1 件以上、空欄/プレースホルダ無し
 *   3. 「残 NG 0 件」の明示
 *
 * @param {string} body PR 本文
 * @returns {AcCheckResult}
 */
export function checkIntegrationEvidenceTable(body) {
	const sectionIdx = body.indexOf(INTEGRATION_EVIDENCE_SECTION);
	if (sectionIdx === -1) {
		return {
			ok: false,
			lane: 'integration',
			error:
				`❌ 統合 PR (lane=integration) の本文に「${INTEGRATION_EVIDENCE_SECTION}」セクションがありません (#2945 AC3)\n\n` +
				'統合 PR は単一 Issue の AC を持たないため、per-PR AC マップの代わりに\n' +
				'マージ判定エビデンス表（含有 PR / 対象領域 / 対応テストケース / 結果 + 残 NG 0 件）を記載してください。\n' +
				'（audit-team.md §3.5。検証の放棄ではなく観点の切替です — #2945 no-go）',
		};
	}

	const rows = extractFourColumnRows(body, sectionIdx);
	const emptyRows = findEmptyRows(rows);
	const info = [
		`integration evidence rows found: ${rows.length}, empty/placeholder rows: ${emptyRows.length}`,
	];

	if (rows.length === 0) {
		return {
			ok: false,
			lane: 'integration',
			info,
			error:
				`❌ 「${INTEGRATION_EVIDENCE_SECTION}」に 4 列のデータ行が 1 件もありません (#2945 AC3)\n\n` +
				'含有 PR ごとに 1 行を埋めてください（含有 PR / 対象領域 / 対応テストケース / 結果）。\n' +
				'例:\n| 機能 A（#NNNN） | admin/activities | unit×3 / e2e×1 | pass |',
		};
	}

	if (emptyRows.length > 0) {
		const details = emptyRows.map((r) => `  ${r.slice(0, 120)}`).join('\n');
		return {
			ok: false,
			lane: 'integration',
			info,
			error:
				`❌ 「${INTEGRATION_EVIDENCE_SECTION}」に ${emptyRows.length} 件の空欄/プレースホルダ行があります (#2945 AC3)\n\n` +
				'4 列（含有 PR / 対象領域 / 対応テストケース / 結果）を全て埋めてください（偽装空欄を素通りさせません）。\n\n' +
				`空欄行:\n${details}`,
		};
	}

	if (!NG_ZERO_PATTERN.test(body)) {
		return {
			ok: false,
			lane: 'integration',
			info,
			error:
				'❌ 統合 PR の本文に「残 NG 0 件」の明示がありません (#2945 AC3 / audit-team.md §3.5 #5)\n\n' +
				'8 領域 finding のうち severity 閾値以上の未解決 NG が 0 件であることを明記してください。\n' +
				'（例:「残 NG 合計 0 件」をエビデンス表 / 本文に記載）',
		};
	}

	return {
		ok: true,
		lane: 'integration',
		info,
		reason: 'マージ判定エビデンス表: 4 列全行 + 残 NG 0 件 明示 ✓',
	};
}

/**
 * lane に応じて AC 検証観点を切替えるエントリ（job は全 lane で実行され、内部で観点を切替える）。
 *
 * @param {{
 *   body: string;
 *   labels: string[];
 *   lane: 'feature'|'integration'|'hotfix'|'dependabot';
 * }} input
 * @returns {AcCheckResult}
 */
export function checkAcVerification({ body, labels, lane }) {
	const skip = shouldSkip({ body, labels, lane });
	if (skip.skip) {
		return { ok: true, lane, reason: `skip: ${skip.reason}` };
	}

	if (lane === 'integration') {
		return checkIntegrationEvidenceTable(body);
	}
	// feature / hotfix / dependabot（dependabot は job-level if で skip されるため通常到達しないが、
	// 到達した場合も per-PR AC マップ観点で評価する。観点切替は integration のみ）。
	return checkPerPrAcMap(body, lane === 'hotfix' ? 'hotfix' : 'feature');
}

// --- CLI（ローカル検証用。PR_BODY / PR_LABELS / PR_LANE を env or argv で受ける）---

const isMain = (() => {
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	const argv = process.argv.slice(2);
	/** @type {Record<string, string>} */
	const opt = {};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a?.startsWith('--')) {
			const eq = a.indexOf('=');
			if (eq !== -1) opt[a.slice(2, eq)] = a.slice(eq + 1);
			else {
				opt[a.slice(2)] = argv[i + 1] ?? '';
				i += 1;
			}
		}
	}
	const body = opt.body ?? process.env.PR_BODY ?? '';
	const lane = /** @type {any} */ (opt.lane ?? process.env.PR_LANE ?? 'feature');
	const labels = (opt.labels ?? process.env.PR_LABELS_CSV ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	if (!body && !opt.lane && !process.env.PR_LANE) {
		console.error(
			'[check-ac-verification-map] Usage: node scripts/check-ac-verification-map.mjs --lane <lane> --body <body> [--labels a,b]',
		);
		process.exit(2);
	}

	const result = checkAcVerification({ body, labels, lane });
	for (const line of result.info ?? []) console.log(line);
	if (result.ok) {
		console.log(`✅ ${result.reason ?? 'PASS'} (lane=${result.lane})`);
		process.exit(0);
	}
	console.error(result.error ?? '❌ FAIL');
	process.exit(1);
}
