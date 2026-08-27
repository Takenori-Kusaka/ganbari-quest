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
 * # feature / hotfix lane に per-PR AC マップ判定は無い（#4305 → #4348 で残骸を削除）
 *
 * #4305 が **PR テンプレートから `## AC 検証マップ` 節ごと撤去**し（現テンプレートは 7 節）、
 * 本 entry も feature / hotfix lane を無条件 PASS に変えた。判定関数 `checkPerPrAcMap` は
 * その時に呼び出し元を失い、**唯一の呼び出しが自身の unit test だけ**という状態で
 * 8 ヶ月ぶんの改修（#3488 / #3846 等）を受け続けていた。#4348 で削除した。
 *
 * 再導入するなら、判定関数だけを戻しても機能しない。**PR テンプレートの節・
 * `.github/PR_TEMPLATE_SECTIONS.json`・本 entry の分岐・workflow 配線をセットで**戻すこと。
 * 「判定関数だけが存在して誰も呼ばない」状態は `tests/unit/scripts/check-ac-verification-map.test.ts`
 * の class-lock が落とす。
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
