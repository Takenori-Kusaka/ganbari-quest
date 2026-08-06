import {
	extractH2Section,
	stripFencedCode,
	stripHtmlComments,
} from './lib/ci/pr-body-sections.mjs';
import { MIN_REASON_LENGTH, parseReasonDeclaration } from './lib/ci/reason-declaration.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

/** 統合 PR の検証で要求する section 見出し（暫定。統合 PR template 確定は Phase B #2871）。 */
export const INTEGRATION_EVIDENCE_SECTION = 'マージ判定エビデンス表';

/**
 * 残 NG 件数の宣言を読む section 見出し（#4333 AC2）。
 * SSOT: `.github/INTEGRATION_PR_TEMPLATE_SECTIONS.json` の `## NG 0 件 / カバレッジ宣言`。
 * 同期は `tests/unit/scripts/check-ac-verification-map.test.ts` の生成側 assert が固定する。
 */
export const NG_DECLARATION_SECTION = 'NG 0 件 / カバレッジ宣言';

/**
 * 残 NG > 0 のまま merge することを明示的に受容する宣言 key（#4333）。
 *
 * gate を hard-fail のみにすると「正直に 残 NG 1 件 と書くと merge できない」ため、
 * **嘘の 0 件宣言に倒すインセンティブ**が生まれる（#4304 は正直に書いたのに gate が緑だった
 * のが問題であって、正直さを罰するのが目的ではない）。よって逃げ道は塞がず、
 * **理由 + 追跡 Issue を伴う明示宣言でのみ通す**（#4084 の 4 宣言と同じ思想・同じ SSOT）。
 */
export const NG_NONZERO_ACCEPTED_KEY = 'ng-nonzero-accepted';

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

/**
 * 残 NG **件数** の宣言を読み取るパターン（#4333）。件数を capture group 1 で取り出す。
 *
 * 旧実装は `/残\s*NG[^\n|]*[:：]?\s*0\b|NG\s*0\s*件/` を **本文全体**に `test()` するだけで、
 * 「0 という文字が本文のどこかにあるか」しか見ていなかった。実測された素通り経路:
 *
 *   - `## NG 0 件 / カバレッジ宣言`（**見出しそのもの**。template を貼れば必ず存在する）
 *   - `<!-- 残 NG 0 件 明示を検証する -->`（template の HTML コメント。誰にも見えない）
 *   - `**「残 NG 0」を偽って宣言しない。**`（**否定文**。文意と逆に判定される）
 *   - `残 NG は 10 件`（`[^\n|]*` が「は 1」を食い、続く `0\b` に一致して **10 件が 0 件扱い**）
 *
 * つまり NG-0 gate は全統合 PR で常に緑だった（#4304 で severity 4 の残 NG を正直に宣言した
 * PR がそのまま緑になったことで発覚）。存在検査をやめ、**宣言された件数を読んで 0 か判定する**。
 *
 * `[^\n|]` で行と table cell を跨がせないのは、宣言は prose であって表のセル結合ではないため。
 * 数値は最短一致側から拾うので `残 NG は 10 件` は 10 と読む（0 を拾わない）。
 */
const NG_COUNT_DECLARATION = /残(?:り|る)?\s*(?:の)?[^\n|]{0,24}?NG[^\n|]{0,24}?(\d+)\s*件/g;

/** 受容宣言の理由に要求する追跡 Issue 参照（「どこで追うのか」を書かせる）。 */
const ISSUE_REFERENCE_PATTERN = /#\d{2,}/;

/**
 * section 探索 / 除去前処理は `scripts/lib/ci/pr-body-sections.mjs` が SSOT (#4348 で移設)。
 *
 * #4333 では本 file 内に置いていたが、同 class の緩い判定が他の gate にも残っていたため
 * (`pr-template-gate-checks` / `check-merge-gate-checklist` 等)、判定の二重実装を作らないよう
 * 共有 util へ移し、本 file は再 export で後方互換を保つ。
 */
export { extractH2Section, stripFencedCode, stripHtmlComments };

/**
 * section 本体から「残 NG N 件」の宣言を全件読み取る（#4333）。
 *
 * 1 件でも 0 以外があれば残 NG は 0 ではない、と扱う（本文が「0 件」と「1 件」を
 * 同時に主張している状態を pass にしない）。
 *
 * @param {string} sectionText 見出し行を含まない section 本体
 * @returns {{ count: number; line: string }[]}
 */
export function parseNgCountDeclarations(sectionText) {
	const scrubbed = stripFencedCode(stripHtmlComments(sectionText));
	/** @type {{ count: number; line: string }[]} */
	const found = [];
	for (const line of scrubbed.split('\n')) {
		for (const m of line.matchAll(NG_COUNT_DECLARATION)) {
			found.push({ count: Number(m[1]), line: line.trim() });
		}
	}
	return found;
}

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
	return pickFourColumnRows(section);
}

/**
 * section 本体から 4 列のデータ行を拾う（header / separator を除く）。
 *
 * @param {string} section
 * @returns {string[]}
 */
function pickFourColumnRows(section) {
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
	const evidence = extractH2Section(body, INTEGRATION_EVIDENCE_SECTION);
	if (!evidence.found) {
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

	const rows = pickFourColumnRows(evidence.text);
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

	const ng = checkNgZeroDeclaration(body);
	info.push(...(ng.info ?? []));
	if (!ng.ok) {
		return { ok: false, lane: 'integration', info, error: ng.error };
	}

	return {
		ok: true,
		lane: 'integration',
		info,
		reason: `マージ判定エビデンス表: 4 列全行 ✓ / ${ng.reason}`,
	};
}

/**
 * 「残 NG 0 件」宣言の検証（#4333、audit-team.md §3.5 #5）。
 *
 * **存在検査ではなく件数検査**である。`## NG 0 件 / カバレッジ宣言` section 内から
 * HTML コメント / code block を除いたうえで「残 NG N 件」を全件読み、
 *
 *   - section が無い / 宣言が 1 件も無い → **fail**（検査できないものを pass にしない）
 *   - 1 件でも N > 0 → **fail**（ただし明示的な受容宣言があれば pass、下記）
 *
 * 受容宣言 `<!-- ng-nonzero-accepted: <理由 + 追跡 Issue> -->` は、
 * 残 NG があることを認めたうえで merge する場合の唯一の経路。理由の実体判定は
 * `scripts/lib/ci/reason-declaration.mjs`（#4084 の 4 宣言と同一 SSOT）に委譲し、
 * さらに追跡 Issue 参照（`#NNNN`）を要求する。**宣言は本文に残るので後から grep できる** —
 * 「見出しがあるだけで緑」だった旧実装との決定的な違いはここにある。
 *
 * @param {string} body PR 本文
 * @returns {{ ok: boolean; reason?: string; error?: string; info?: string[] }}
 */
export function checkNgZeroDeclaration(body) {
	const section = extractH2Section(body, NG_DECLARATION_SECTION);
	if (!section.found) {
		return {
			ok: false,
			error:
				`❌ 統合 PR の本文に「## ${NG_DECLARATION_SECTION}」section がありません (#4333 / audit-team.md §3.5 #5)\n\n` +
				'残 NG 件数の宣言はこの section 内でのみ読み取ります（本文の他の場所・HTML コメント・見出しは対象外）。\n' +
				'.github/INTEGRATION_PR_TEMPLATE.md の該当 section を復元してください。',
		};
	}

	const declarations = parseNgCountDeclarations(section.text);
	const info = [
		`NG declarations found: ${declarations.length} (${declarations.map((d) => d.count).join(',') || 'none'})`,
	];

	if (declarations.length === 0) {
		return {
			ok: false,
			info,
			error:
				`❌ 「## ${NG_DECLARATION_SECTION}」section に残 NG 件数の宣言がありません (#4333)\n\n` +
				'見出しがあるだけでは通しません（旧実装は見出しの文字列だけで緑になっていました）。\n' +
				'section 本体に件数を明記してください。例:「残 NG 合計 0 件 (severity 3-4 の未解決 finding なし)」\n' +
				'HTML コメント内 / code block 内の記述は判定対象外です。',
		};
	}

	const nonZero = declarations.filter((d) => d.count !== 0);
	if (nonZero.length === 0) {
		return { ok: true, info, reason: '残 NG 0 件 宣言 ✓' };
	}

	const accepted = parseReasonDeclaration(body, NG_NONZERO_ACCEPTED_KEY);
	const details = nonZero
		.map((d) => `  残 NG ${d.count} 件: 「${d.line.slice(0, 100)}」`)
		.join('\n');

	if (!accepted.present) {
		return {
			ok: false,
			info,
			error:
				`❌ 残 NG が 0 件ではありません (#4333 / audit-team.md §3.5 #5)\n\n${details}\n\n` +
				'残 NG > 0 のまま merge するなら、本文に受容宣言を明記してください（嘘の 0 件宣言に倒さないための経路です）:\n' +
				`  <!-- ${NG_NONZERO_ACCEPTED_KEY}: <なぜ本 release で塞がないのか> (#追跡Issue番号) -->\n` +
				'宣言しない場合は §3.6 起票/棄却 flow に送り、残 NG を 0 にしてから merge してください。',
		};
	}

	if (!accepted.valid || !ISSUE_REFERENCE_PATTERN.test(accepted.reason)) {
		return {
			ok: false,
			info,
			error:
				`❌ \`${NG_NONZERO_ACCEPTED_KEY}\` 宣言の理由が受理できません (#4333)\n\n${details}\n\n` +
				`  ${MIN_REASON_LENGTH} 文字以上で「なぜ本 release で塞がないのか」を書き、追跡 Issue 番号 (#NNNN) を含めてください\n` +
				'  (空欄 / TODO / n/a 等の定型 stub は受理しません、#3956 教訓)。\n' +
				`  現在の理由: 「${accepted.reason.slice(0, 100)}」`,
		};
	}

	return {
		ok: true,
		info,
		reason: `残 NG ${nonZero.map((d) => d.count).join('/')} 件（受容宣言あり: ${accepted.reason.slice(0, 60)}）`,
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
