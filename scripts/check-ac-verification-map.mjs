import { isMain as isMainModule } from './lib/is-main.mjs';

/** 統合 PR の検証で要求する section 見出し（暫定。統合 PR template 確定は Phase B #2871）。 */
export const INTEGRATION_EVIDENCE_SECTION = 'マージ判定エビデンス表';

/**
 * #1539: AC マップ 4 列目（結果/エビデンス列）の未完了表記検出パターン。
 *
 * **`follow[\s-]up`（区切り 1 文字必須）の意図（#3488 BLOCK fix）**:
 * `?` で区切りを optional にすると、区切り無しの slug `followup` が部分一致してしまい
 * `docs/research/2026-06-29-followup-treadmill-root-cause.md` のような**完了済エビデンス参照の
 * ファイル名**を未完了表記として誤検出していた（false-positive → gate fail）。
 * 未完了マーカーとしての「follow-up」「follow up」は語間に区切り（空白 or ハイフン）を必ず持つため、
 * 区切り 1 文字必須にすれば slug `followup` を除外しつつ「別途 follow-up で対応」等は検出し続ける。
 * 拡張子 whitelist による strip 前処理は脆く（bypass + 非収録拡張子の FP）、撤去して生 cell に
 * 本パターンを直接適用する方針に戻した（#3488）。
 *
 * **inline-code strip（#3846 / #3844 BLOCK fix）**: 拡張子 whitelist strip（#3488 で撤去）とは別に、
 * evidence cell の **inline-code (`...`) 内トークンのみ** は判定前に strip する。inline-code は
 * 定数名 / コマンド / ファイル参照などの機械トークンであり（例: 定数名 `RANGE_SSOT_TODO` が
 * #3844 で `todo` に部分一致し false-positive gate fail）、未完了宣言の prose ではない。
 * 未完了マーカーを backtick で囲んで逃避する pattern は QM レビュー + PR body 禁止語 gate
 * (`check-pr-body.mjs`) の別層で扱う。prose（コード外）の未完了表記検出は従来どおり生 cell。
 */
const TODO_PATTERN = /todo|予定|追加予定|別途|follow[\s-]up|後で/i;

/**
 * evidence cell 内の inline-code span（`...`）を除去する（#3846）。
 * table cell は `|` split 済のため改行を含まず、backtick 対を単純除去すれば十分。
 * 対にならない孤立 backtick は残す（除去しすぎによる検出漏れ防止）。
 *
 * @param {string} cell
 * @returns {string}
 */
function stripInlineCode(cell) {
	return cell.replace(/`[^`]*`/g, '');
}

/** integration lane の「残 NG 0 件」明示を検出するパターン（audit-team.md §3.5 #5）。 */
const NG_ZERO_PATTERN = /残\s*NG\s*(?:合計\s*)?0\s*件|残\s*NG[^\n|]*[:：]?\s*0\b|NG\s*0\s*件/;

/**
 * 次の `## ` 見出し（H2）の直前までを切り出す。見出しが無ければ全体を返す。
 *
 * `###` 以降の下位見出しでは止めない（同一セクション内の小見出しは表の所属を変えないため）。
 *
 * @param {string} text 見出し行を除いたセクション以降のテキスト
 * @returns {string} 当該セクション本体
 */
function sliceUntilNextH2(text) {
	const lines = text.split('\n');
	const end = lines.findIndex((l) => l.startsWith('## '));
	return end === -1 ? text : lines.slice(0, end).join('\n');
}

/**
 * AC 検証マップの 4 列行を本文から抽出する（共通 util）。
 * ヘッダー行（`| AC 番号 | AC 内容 ...` 等）とセパレーター（`|---|---|`）を除外する。
 *
 * **走査は当該セクション内で閉じる**（次の `## ` 見出しで停止、#4243）。
 * 本文末尾まで見ていた旧実装は、統合 PR template が「マージ判定エビデンス」の**後ろ**に
 * 4 列の表（Accepted residual 等）を持つため、**別表の行を evidence の行として数えていた**。
 * 壊れ方は 2 方向あった:
 *
 *   - false positive: 後続表のプレースホルダ行を空欄と誤判定し、evidence 表が正しくても fail
 *     （bot 生成の統合 PR が生まれた瞬間に落ちる。#4241 で実測）
 *   - false negative: evidence 表が**空でも**後続表の 4 列行で `rows.length === 0` を通過し、
 *     「main 反映前に evidence を必ず埋めさせる」という gate の目的が満たされない（より危険）
 *
 * @param {string} body PR 本文
 * @param {number} fromIdx 抽出開始 index（section 見出し以降に限定する用途）
 * @returns {string[]} 4 列のデータ行（生のマークダウン行）
 */
function extractFourColumnRows(body, fromIdx) {
	const rest = body.slice(fromIdx);
	// 見出し行自身を飛ばしてから、次の `## ` 見出しまでを section 本体とする。
	const afterHeading = rest.indexOf('\n');
	const section =
		afterHeading === -1
			? rest
			: rest.slice(0, afterHeading + 1) + sliceUntilNextH2(rest.slice(afterHeading + 1));
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
			// #3846: inline-code 内の機械トークン（定数名 / コマンド / ファイル参照）は判定対象外
			if (TODO_PATTERN.test(stripInlineCode(evidenceCell))) {
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
	if (lane === 'integration') {
		const skip = shouldSkip({ body, labels, lane });
		if (skip.skip) {
			return { ok: true, lane, reason: `skip: ${skip.reason}` };
		}
		return checkIntegrationEvidenceTable(body);
	}
	// feature / hotfix / dependabot: AC map verification is removed as part of Issue #4305.
	return {
		ok: true,
		lane,
		reason: 'feature/hotfix lane: AC verification map check has been removed (#4305)',
	};
}

// --- CLI（ローカル検証用。PR_BODY / PR_LABELS / PR_LANE を env or argv で受ける）---

const isMain = isMainModule(import.meta.url);

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
