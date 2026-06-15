#!/usr/bin/env node
/**
 * scripts/check-pr-screenshot.mjs
 *
 * #1740 + #1741 + #1766 (#1747 AC4) + #2017: PR スクリーンショット添付の品質ゲート。
 *
 * 1. **ローカルパス禁止検証 (#1741)**
 *    PR body 内の `tmp/screenshots/...` / `.tmp-screenshots/...` 等のローカル相対パス参照を検知して fail。
 *    GitHub web 上で表示できない URL を使うと QM 代替撮影が必要になる事故を防ぐ
 *    (PR #1691 で観察された運用問題の構造対策)。
 *
 * 2. **修正前 / 修正後ラベル検証 (#1740)**
 *    PR body の Markdown 画像 (`![alt](url)`) または HTML img の alt / surrounding text に
 *    「修正前 / Before / before-...」「修正後 / After / after-...」のいずれもが含まれているかを検証。
 *    両方が揃わない場合、警告 / 失敗 (mode により切替)。
 *
 * 3. **DOM スナップショット併記検証 (#1766 / #1747 AC4)**
 *    UI PR で SS を 1 枚以上添付している場合、対応する `.dom.html` リンクが PR body に
 *    1 つ以上含まれることを検証。SS と同一プロセスで取得した DOM が併記されることで、
 *    PR #1717 で発生した「SS と実機が乖離している」事故の再発を機械的に検出可能にする。
 *
 * 4. **スキップ判定 (#2017 拡張)**
 *    docs only / refactor 系の PR (UI 関連ファイルを含まない) は全検証ともスキップ。
 *    加えて以下も skip:
 *    - PR body に「該当なし（refactor / docs / chore）」「UI 変更なし」明示記述
 *    - **PR ラベル `refactor:internal-no-doc-impact` 付与 (#2017)**
 *      → I1 (#1985) design-doc-check label exempt と同パターン。
 *      shared-labels.js / svelte の atom 化 refactor (visual diff ゼロ) で screenshot-check が
 *      毎回 fail し SS 補完 Agent 工数を消費する構造課題を解消 (Wave 5-8 で 5+ PR が遭遇)。
 *      ラベル付与の責任・悪用防止運用は ADR-0003 §4.1-§4.3 に統合。
 *
 *    ファイルパターンは scripts/check-pr-screenshot.mjs::isUiPr() 参照。
 *
 * 5. **段階適用フラグ (#1740 — 「最初は警告のみで開始 → 1-2 週間 dogfooding → エラー化」要件)**
 *    env `SCREENSHOT_CHECK_MODE` で動作切替:
 *    - `warn` (default): すべての違反を warning として記録、exit 0
 *    - `error`: 違反があれば exit 1 (CI を red にする)
 *
 *    ローカルパス禁止 (#1741) は警告でもログとして表示される。CI ジョブ側で
 *    `SCREENSHOT_CHECK_MODE: warn` で warming 期間を運用し、定着後に `error` に昇格する設計。
 *
 * 想定実行環境: GitHub Actions の pull_request トリガ
 *   env:
 *     PR_BODY:   ${{ github.event.pull_request.body }}
 *     PR_FILES:  改行区切りの変更ファイル一覧（gh pr view --json files で取得）
 *     PR_LABELS: カンマ区切りの PR ラベル一覧 (#2017)
 *     SCREENSHOT_CHECK_MODE: 'warn' (default) | 'error'
 *
 * ローカル実行例:
 *   PR_BODY="$(gh pr view 1740 --json body --jq .body)" \
 *   PR_FILES="$(gh pr view 1740 --json files --jq '.files[].path' | tr '\n' '\n')" \
 *   PR_LABELS="$(gh pr view 1740 --json labels --jq '[.labels[].name] | join(",")')" \
 *     node scripts/check-pr-screenshot.mjs
 *
 * exit:
 *   0 = OK, または warn モードで違反あり
 *   1 = error モードで違反あり
 *   2 = internal error
 */

const MODE = (process.env.SCREENSHOT_CHECK_MODE || 'warn').toLowerCase();
// #2946 (Phase A/A-4): lane 判定は SSOT (scripts/pr-lane.mjs + actions/pr-lane) が出した
// 値を env PR_LANE で受け取るだけ。本 script 内で base/head/actor から lane を再判定しない
// (no-go: lane 判定ロジックの inline 重複禁止)。未設定時は 'feature' (軽量レーン、後方互換)。
const PR_LANE = (process.env.PR_LANE || 'feature').trim().toLowerCase();
const PR_BODY = process.env.PR_BODY || '';
const PR_FILES = (process.env.PR_FILES || '')
	.split('\n')
	.map((s) => s.trim())
	.filter(Boolean);
const PR_LABELS = (process.env.PR_LABELS || '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// ---------------------------------------------------------------------------
// 検証関数（pure functions, named exports for unit testing）
// ---------------------------------------------------------------------------

const UI_FILE_PATTERN = /\.(svelte|svelte\.ts|svelte\.js|css|scss)$|^site\//;

/**
 * 変更ファイル一覧から UI 関連ファイルが含まれるかを判定。
 * 含まれない場合 SS は不要（docs only / refactor / chore のみの PR）。
 *
 * @param {string[]} files
 * @returns {boolean}
 */
export function isUiPr(files) {
	return files.some((f) => UI_FILE_PATTERN.test(f));
}

const LOCAL_PATH_PATTERNS = [
	// Markdown image: ![alt](tmp/...) / ![alt](.tmp-screenshots/...)
	/!\[[^\]]*\]\((?:\.\/)?(?:tmp|\.tmp-screenshots)\/[^)]+\)/g,
	// HTML img: <img src="tmp/..."> / <img src=".tmp-screenshots/...">
	/<img[^>]+src=["'](?:\.\/)?(?:tmp|\.tmp-screenshots)\/[^"']+["'][^>]*>/g,
];

/**
 * PR body 内のローカル相対パス参照（tmp/ / .tmp-screenshots/）を検出する。
 *
 * @param {string} body
 * @returns {string[]} 検出された違反箇所の文字列配列
 */
export function detectLocalPaths(body) {
	const violations = [];
	for (const pattern of LOCAL_PATH_PATTERNS) {
		const matches = body.matchAll(pattern);
		for (const m of matches) {
			violations.push(m[0]);
		}
	}
	return violations;
}

const BEFORE_LABEL_PATTERN =
	/!\[[^\]]*(?:修正前|before)[^\]]*\]|<img[^>]*alt=["'][^"']*(?:修正前|before)[^"']*["']/i;
const AFTER_LABEL_PATTERN =
	/!\[[^\]]*(?:修正後|after)[^\]]*\]|<img[^>]*alt=["'][^"']*(?:修正後|after)[^"']*["']/i;

/**
 * PR body から「修正前」「修正後」両方のラベル付き画像参照が見つかるかを判定。
 *
 * 検出パターン:
 * - ![before-mobile](url) / ![Before: ...](url) / ![修正前](url)
 * - <img alt="after-pc" .../> / <img alt="修正後" .../>
 *
 * @param {string} body
 * @returns {{ hasBefore: boolean, hasAfter: boolean }}
 */
export function detectBeforeAfterLabels(body) {
	return {
		hasBefore: BEFORE_LABEL_PATTERN.test(body),
		hasAfter: AFTER_LABEL_PATTERN.test(body),
	};
}

/**
 * 「該当なし」明示記述の検出。refactor / docs / chore のみで UI 影響がない PR の opt-out 用。
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasUiNotApplicableMarker(body) {
	return /該当なし\s*[（(](?:refactor|docs|chore)/i.test(body) || /UI\s*変更\s*なし/i.test(body);
}

/**
 * 内部 refactor exempt のラベル名 (#2017、#1985 と同一値で運用統一)。
 *
 * I1 (#1985) で design-doc-check に導入されたラベルを screenshot-check でも併用する。
 * ラベル付与の判断基準・悪用防止運用は ADR-0003 §4.1-§4.3 に集約 (4 条件すべて満たす:
 * 機能仕様変化なし / atom-compound 階層化 / リテラル置換のみ / import 追加 + literal removal の diff)。
 */
export const INTERNAL_REFACTOR_LABEL = 'refactor:internal-no-doc-impact';

/**
 * PR ラベル一覧に `refactor:internal-no-doc-impact` が含まれるかを判定 (#2017)。
 *
 * 大文字小文字無視 + 部分一致禁止 (悪用防止)。
 *
 * @param {string[]} labels
 * @returns {boolean}
 */
export function hasInternalRefactorLabel(labels) {
	return labels.some((l) => l.trim().toLowerCase() === INTERNAL_REFACTOR_LABEL);
}

// 画像参照: ![alt](url) / <img src="url">  → URL 部分を抽出
const IMAGE_REF_PATTERN = /!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/g;
// DOM HTML リファレンス: [text](url.dom.html) または素の URL 末尾 .dom.html
const DOM_REF_PATTERN = /\[[^\]]*\]\([^)]+\.dom\.html[^)]*\)|[\s(]https?:\/\/\S+\.dom\.html\b/;

/**
 * PR body から画像参照 URL を抽出する（src のみ、alt / text は除く）。
 *
 * @param {string} body
 * @returns {string[]}
 */
export function extractImageUrls(body) {
	const urls = [];
	for (const m of body.matchAll(IMAGE_REF_PATTERN)) {
		const url = m[1] || m[2];
		if (url) urls.push(url);
	}
	return urls;
}

/**
 * URL がスクリーンショット (拡張子 .png / .jpg / .jpeg / .webp / .gif) を指しているかを判定。
 * HTTPS 以外の URL や user-attachments の uuid (拡張子なし) は false を返す。
 *
 * 注 (#2929): user-attachments URL を本関数で true にすると、DOM スナップショット併記検証
 * (#1766、checkDomSnapshotViolation) が drag&drop SS (capture.mjs 非経由で .dom.html を持たない)
 * にも .dom.html を要求して false-warn する。embed 判定での user-attachments 許容は
 * hasEmbeddedScreenshotImage 側 (isUserAttachmentAssetUrl) で行い、本関数は拡張子判定に限定する。
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isScreenshotUrl(url) {
	return /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(url);
}

// GitHub drag&drop で生成される添付 URL (拡張子なし uuid)。
// 例: https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb
const USER_ATTACHMENT_URL_PATTERN = /^https:\/\/github\.com\/user-attachments\/assets\/[\w-]+$/i;

/**
 * URL が GitHub user-attachments の添付 (PR body へのドラッグ&ドロップで生成、拡張子なし uuid)
 * かを判定する (#2929 項目 1)。
 *
 * PR template (`.github/PULL_REQUEST_TEMPLATE.md`) / dev-session.md / 本 script の修復メッセージは
 * いずれも user-attachments を正規の embed 手段として案内しているため、embed 判定
 * (hasEmbeddedScreenshotImage) で screenshot 同等に扱う。query / fragment 付きは添付 uuid の
 * 正規形ではないため不一致とする。
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isUserAttachmentAssetUrl(url) {
	return USER_ATTACHMENT_URL_PATTERN.test(url);
}

/**
 * PR body 内に DOM HTML (.dom.html) スナップショットへの参照が含まれるかを判定 (#1766 / #1747 AC4)。
 *
 * 検出パターン:
 * - Markdown link: `[DOM HTML](https://.../foo.dom.html)`
 * - 素の URL: `https://.../foo.dom.html`
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasDomSnapshotReference(body) {
	return DOM_REF_PATTERN.test(body);
}

// ---------------------------------------------------------------------------
// #2946 (Phase A/A-4): integration lane (develop→main 統合 PR) の SS 観点切替
//
// 統合 PR は複数 feature を束ねるバッチであり「修正前 / 修正後」という単一比較軸が
// 成立しない (複数機能の SS を 1 つの before/after 表に収められない)。そのため
// integration lane では before/after 4 スロットを必須にせず、SS 観点を
// 「① 統合状態の visual regression (VR 3 層: lp / child-home / app) への紐づけ +
//  ② 含有 PR 群が develop 取込時に SS 検証済である確認」に切り替える (AC3)。
//
// VR 3 層 (`*-visual-regression.yml`) は main 向け PR (= integration / hotfix) で
// 発火し統合状態の見た目回帰を baseline 比較で別途担保する (docs/CLAUDE.md
// §visual regression 3 層 / branch-strategy.md §4)。本検証は「VR への委譲」が
// 明示されているか (= 見た目検証を完全には消していない、no-go) を PR body で確認する。
// ---------------------------------------------------------------------------

// 統合 PR の SS 観点で受理する evidence マーカー。以下のいずれかが PR body に
// 含まれれば「VR 3 層への紐づけ / 含有 PR の SS 検証済確認」が宣言されたとみなす。
// 観点の移譲であって検証の放棄ではない (Issue #2946 選択肢 A) ため、generic な
// 文字列ではなく VR 層名 / 含有 PR / visual regression workflow を指す語に限定する。
const INTEGRATION_VR_EVIDENCE_PATTERNS = [
	// VR 3 層 workflow への言及 (lp / child-home / app visual regression)
	/visual[\s-]*regression/i,
	/\*?-visual-regression\.yml/i,
	/(?:lp|child-home|app)[\s-]*(?:visual|vr|pixelmatch|baseline)/i,
	// 含有 PR 群が develop 取込時に SS 検証済である宣言
	/含有\s*PR/,
	/(?:取込|取り込み)\s*(?:済|時).*(?:SS|スクリーンショット|スクショ|検証)/,
	/統合\s*(?:対象|状態|smoke)/,
];

/**
 * integration lane (統合 PR) の SS 観点 evidence が PR body に含まれるかを判定 (#2946)。
 *
 * before/after 4 スロットの代わりに、統合 PR では以下のいずれかの宣言を要求する:
 * - VR 3 層 (lp / child-home / app visual regression) 結果への紐づけ
 * - 含有 PR 群が develop 取込時に SS 検証済である確認
 * - 統合状態の smoke / 統合対象 PR 群の参照
 *
 * 「観点の移譲」であって「検証の放棄」ではない (no-go: 見た目検証を完全に消さない) ため、
 * いずれの evidence も無い場合は違反として扱う (warn / error は MODE 依存)。
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasIntegrationVrEvidence(body) {
	return INTEGRATION_VR_EVIDENCE_PATTERNS.some((p) => p.test(body));
}

// ---------------------------------------------------------------------------
// #2918: SS embed 未完了 (未来形記述 / GitHub 表示可能な embed 画像不在) の検出
//
// QM レビューで UI 変更 PR が「SS は後で push する」という未来形記述のまま Ready 化され、
// CI screenshot-check fail で BLOCK → Fix Agent 往復 が 4 件連続 (#2913 / #2914 / #2915 /
// #2909) 発生した。実装品質は高いが「SS 撮影 → screenshots branch push → body embed」の
// 最終ステップだけが省略される構造に対し、Ready 化前 (ローカル pre-ready) で hard-fail する。
//
// CI screenshot-check (main 処理) とロジック SSOT を共有するため、検出関数は本ファイルに集約し
// pre-ready は env SCREENSHOT_EMBED_GATE 経由で本検証のみを error モードで起動する (二重実装しない)。
//
// 検出軸の責務分離マップ (#2929 項目 2 で収斂・明文化):
//
// | 検出軸                          | pre-ready Step 11b (mainEmbedGate) | CI main() (screenshot-quality-check) |
// |---------------------------------|------------------------------------|--------------------------------------|
// | ローカルパス禁止 (#1741)        | error                              | warn (MODE 昇格で error)             |
// | before/after ラベル (#1740)     | — (CI 専任)                        | warn (同上)                          |
// | DOM 併記 (#1766)                | — (CI 専任)                        | warn (同上)                          |
// | 未来形記述 (#2918)              | error                              | warn (同上、#2929 で追加)            |
// | embed 不在 (#2918)              | error                              | warn (同上、#2929 で追加)            |
//
// authoritative は CI 側 (pr-quality-gate.yml)。pre-ready Step 11b は gh 失敗時に fail-open
// (WARN + skip) する defense-in-depth であり、最終判定は CI が担う。なお legacy job
// `screenshot-check` (pr-quality-gate.yml 内 inline github-script) は「UI PR に画像 1 件以上」
// のみを hard-fail する独立 gate として併存する (required check のため一本化は lane 設計変更を
// 伴い #2929 では据置)。
// ---------------------------------------------------------------------------

// 未来形 / 予告記述パターン。「SS は (後で) push する」「添付予定」「撮影予定」等の未完了宣言。
// 「push 済み」「添付しました」等の完了形は誤検出しないよう、予告を示す語尾のみに限定する。
const FUTURE_TENSE_PATTERNS = [
	/screenshots?\s*branch\s*へ?\s*(?:後で|あとで)?\s*push\s*(?:する|します|予定)/i,
	/(?:スクリーンショット|スクショ|SS|画像)\s*(?:は|を)?\s*(?:後で|あとで|別途|のちほど)/,
	/(?:添付|撮影|貼付|貼り付け|push|アップロード)\s*(?:予定|します|する予定|したい|する)\b/,
	/(?:後で|あとで|のちほど|別途)\s*(?:添付|撮影|貼付|貼り付け|push|アップロード|追加)/,
	/(?:TODO|todo)\s*[:：]?\s*(?:SS|スクショ|スクリーンショット|画像)/,
];

/**
 * PR body 内に「SS は後で push する / 添付予定」等の未来形・未完了宣言が含まれるかを判定 (#2918)。
 *
 * 例 (fail とすべき記述):
 * - 「SS は screenshots branch へ push する」
 * - 「スクリーンショットは後で添付します」
 * - 「TODO: スクショ追加」
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasFutureTenseScreenshotMarker(body) {
	return FUTURE_TENSE_PATTERNS.some((p) => p.test(body));
}

/**
 * PR body 内に GitHub Web 上で表示可能な (= remote URL の) スクリーンショット embed 画像が
 * 1 件以上あるかを判定 (#2918)。
 *
 * - ローカルパス (tmp/ / .tmp-screenshots/) のみの参照は embed とみなさない (detectLocalPaths で別途 fail)
 * - http(s) URL かつ画像拡張子 (.png/.jpg/.jpeg/.webp/.gif) を持つものを embed として数える
 * - GitHub user-attachments URL (drag&drop、拡張子なし uuid) も embed として数える (#2929 項目 1。
 *   PR template / dev-session.md が正規手段として案内する経路を gate が false-positive fail しない)
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasEmbeddedScreenshotImage(body) {
	const urls = extractImageUrls(body);
	return urls.some(
		(url) => /^https?:\/\//i.test(url) && (isScreenshotUrl(url) || isUserAttachmentAssetUrl(url)),
	);
}

/**
 * Ready 化前 SS embed ゲート (#2918)。
 *
 * UI 変更があり exempt でない PR について、PR body に GitHub 表示可能な embed 画像が無い、
 * または未来形記述 (「後で push する」) が残っている場合に違反を返す。
 *
 * skip 条件 (CI screenshot-check と同一 SSOT):
 * - UI 関連ファイル変更なし (isUiPr=false)
 * - 「該当なし（refactor / docs / chore）」「UI 変更なし」明示 (hasUiNotApplicableMarker)
 * - ラベル refactor:internal-no-doc-impact (hasInternalRefactorLabel)
 *
 * @param {{ body: string; files: string[]; labels: string[] }} input
 * @returns {{ skipped: boolean; skipReason: string | null; violations: { id: string; issue: string; message: string }[] }}
 */
export function checkScreenshotEmbedReadiness({ body, files, labels }) {
	const violations = [];

	// ローカルパス参照は UI PR かどうかに関わらず常に違反 (#1741 と同方針)
	const localViolation = checkLocalPathViolation(body);
	if (localViolation) violations.push(localViolation);

	if (!isUiPr(files)) {
		return { skipped: true, skipReason: 'UI 関連ファイル変更なし', violations };
	}
	if (hasUiNotApplicableMarker(body)) {
		return { skipped: true, skipReason: '「該当なし」明示記述あり', violations };
	}
	if (hasInternalRefactorLabel(labels)) {
		return {
			skipped: true,
			skipReason: `PR ラベル '${INTERNAL_REFACTOR_LABEL}' により内部 refactor として exempt (#2017 / ADR-0003 §4)`,
			violations,
		};
	}

	// 未来形記述の検出 (#2918)
	if (hasFutureTenseScreenshotMarker(body)) {
		violations.push(buildFutureTenseViolation());
	}

	// GitHub 表示可能な embed 画像の不在検出 (#2918)
	if (!hasEmbeddedScreenshotImage(body)) {
		violations.push(buildEmbedMissingViolation());
	}

	return { skipped: false, skipReason: null, violations };
}

/**
 * 未来形記述違反 (#2918) を生成する。pre-ready Step 11b (mainEmbedGate) と CI main() の
 * 双方から使う共通 builder (#2929 項目 2 — 検出軸収斂)。
 * @returns {{ id: string; issue: string; message: string }}
 */
function buildFutureTenseViolation() {
	return {
		id: 'future-tense-screenshot',
		issue: '#2918',
		message:
			'PR body に「SS は後で push する / 添付予定」等の未来形・未完了の記述が残っています。\n' +
			'Ready 化前に SS 撮影 → screenshots branch push → body embed を完了してください。\n' +
			'  - node scripts/capture.mjs --pr <N> で撮影 (SS + DOM HTML が screenshots branch に push されます)\n' +
			'  - 出力された Markdown スニペット (raw.githubusercontent.com の embed) を PR body に貼り付け\n' +
			'  - UI 変更を含まない PR の場合は「該当なし（refactor / docs / chore）」と明記してください。',
	};
}

/**
 * embed 画像不在違反 (#2918) を生成する。pre-ready Step 11b と CI main() の共通 builder (#2929)。
 * @returns {{ id: string; issue: string; message: string }}
 */
function buildEmbedMissingViolation() {
	return {
		id: 'screenshot-embed-missing',
		issue: '#2918',
		message:
			'UI 変更 PR ですが、PR body に GitHub Web 上で表示可能な SS embed 画像が 1 件もありません。\n' +
			'(テキスト表のみ / ローカルパス参照のみ / embed 0 件 は Ready 化前 fail です — #2913 / #2914 / #2915 / #2909)\n' +
			'  - node scripts/capture.mjs --pr <N> で撮影 → screenshots branch push\n' +
			'  - raw.githubusercontent.com/.../screenshots/pr-<N>/ 形式の embed 画像を 1 件以上 body に貼り付け\n' +
			'    (GitHub 編集画面への drag&drop で生成される user-attachments URL も可)\n' +
			'  - UI 変更を含まない PR の場合は「該当なし（refactor / docs / chore）」と明記してください。',
	};
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

/**
 * ローカルパス参照違反 (#1741) を生成する。
 * @param {string} body
 * @returns {{ id: string; issue: string; message: string } | null}
 */
function checkLocalPathViolation(body) {
	const localPaths = detectLocalPaths(body);
	if (localPaths.length === 0) return null;
	return {
		id: 'local-path-forbidden',
		issue: '#1741',
		message:
			`PR body にローカル相対パス参照が ${localPaths.length} 件検出されました。GitHub Web 上で表示できる URL に置き換えてください。\n` +
			`検出箇所:\n${localPaths
				.slice(0, 5)
				.map((s) => `  - ${s}`)
				.join('\n')}\n` +
			`\n対応方法:\n` +
			`  - user-attachments URL: PR 本文編集画面に画像をドラッグ&ドロップ\n` +
			`  - screenshots branch raw URL: docs/troubleshoot/screenshot_capture.md SC-007 参照\n` +
			`  - docs/screenshots/ にコミット後、GitHub raw URL を貼付（SC-008 参照）`,
	};
}

/**
 * before/after ラベル欠落違反 (#1740) を生成する。
 * @param {string} body
 * @returns {{ id: string; issue: string; message: string } | null}
 */
function checkBeforeAfterViolation(body) {
	const { hasBefore, hasAfter } = detectBeforeAfterLabels(body);
	if (hasBefore && hasAfter) return null;
	const missing = [];
	if (!hasBefore) missing.push('「修正前 / Before / before-...」ラベル付き画像');
	if (!hasAfter) missing.push('「修正後 / After / after-...」ラベル付き画像');
	return {
		id: 'before-after-missing',
		issue: '#1740',
		message:
			`PR body に ${missing.join(' および ')} が見つかりません。\n` +
			`PR template の「4 スロット添付」セクション（修正前 / 修正後 × モバイル / PC）を参考に、\n` +
			`![before-mobile](URL) / ![after-mobile](URL) / ![before-pc](URL) / ![after-pc](URL) の形式で添付してください。\n` +
			`UI 変更を含まない PR の場合は「該当なし（refactor / docs / chore）」と明記してください。`,
	};
}

/**
 * DOM スナップショット併記欠落違反 (#1766 / #1747 AC4) を生成する。
 * SS が 1 枚以上添付されている UI PR で、対応する .dom.html リンクが無い場合に検出。
 * @param {string} body
 * @returns {{ id: string; issue: string; message: string } | null}
 */
function checkDomSnapshotViolation(body) {
	const imageUrls = extractImageUrls(body);
	const screenshotUrls = imageUrls.filter(isScreenshotUrl);
	if (screenshotUrls.length === 0 || hasDomSnapshotReference(body)) return null;
	return {
		id: 'dom-snapshot-missing',
		issue: '#1766 / #1747 AC4',
		message:
			`UI 変更 PR で SS を ${screenshotUrls.length} 件添付していますが、対応する DOM HTML スナップショット (.dom.html) への参照が PR body に見つかりません。\n` +
			`\n対応方法:\n` +
			`  - scripts/capture.mjs --pr <N> で撮影すると、SS と同一プロセスで DOM HTML (.dom.html) が自動保存されます\n` +
			`  - 出力された Markdown スニペットには SS の直下に [DOM HTML](...) リンクが併記されています\n` +
			`  - PR body にそのまま貼り付けてください\n` +
			`\n背景:\n` +
			`  PR #1717 で発生した「SS と実機が乖離していた」事故の再発防止のため、\n` +
			`  SS と DOM が同一プロセス・同一 page で取得されたことを構造的に保証します（#1747 AC4）。\n` +
			`\nDOM スナップショットを意図的に省略する場合は、--no-dom-snapshot 指定の理由を PR body に明記してください。`,
	};
}

/**
 * integration lane (統合 PR) の SS evidence 欠落違反 (#2946) を生成する。
 * before/after 4 スロットの代わりに VR 3 層紐づけ / 含有 PR SS 検証済の宣言を要求する。
 * @returns {{ id: string; issue: string; message: string }}
 */
function buildIntegrationEvidenceMissingViolation() {
	return {
		id: 'integration-vr-evidence-missing',
		issue: '#2946',
		message:
			'統合 PR (lane=integration、develop→main) ですが、SS 観点の evidence が PR body にありません。\n' +
			'統合 PR は複数機能のバッチで「修正前 / 修正後」の単一比較軸が成立しないため、\n' +
			'before/after 4 スロットの代わりに以下のいずれかを PR body に明記してください:\n' +
			'  - 統合状態の visual regression (VR 3 層: lp / child-home / app の *-visual-regression.yml) 結果への紐づけ\n' +
			'    (main 向け PR では VR 3 層 workflow が自動発火し見た目回帰を baseline 比較で検証します)\n' +
			'  - 含有 PR 群が develop 取込時に SS 検証済であることの確認 (含有 PR 一覧 + SS 検証済の記載)\n' +
			'  - 統合 smoke / 統合対象 PR 群への参照\n' +
			'(VR 3 層への「観点の移譲」であり、見た目検証を完全に消すことは許容しません — #2946 no-go)',
	};
}

function main() {
	const violations = [];

	// 検証 1: ローカルパス禁止 (#1741) — UI PR でなくても貼ったらアウト (lane 非依存)
	const localViolation = checkLocalPathViolation(PR_BODY);
	if (localViolation) violations.push(localViolation);

	// UI PR かどうかで以降の検証をゲート
	const isUi = isUiPr(PR_FILES);
	const optOut = hasUiNotApplicableMarker(PR_BODY);
	const labelExempt = hasInternalRefactorLabel(PR_LABELS);

	let skipReason = null;
	if (!isUi) {
		skipReason = 'UI 関連ファイル変更なし';
	} else if (optOut) {
		skipReason = '「該当なし」明示記述あり';
	} else if (labelExempt) {
		skipReason = `PR ラベル '${INTERNAL_REFACTOR_LABEL}' により内部 refactor として exempt (#2017 / ADR-0003 §4)`;
	}

	// #2946 (Phase A/A-4): lane=integration は SS 観点を切替。
	// before/after 4 スロット / DOM 併記 / embed 不在 (per-PR 単一比較前提) を要求せず、
	// 代わりに VR 3 層への紐づけ / 含有 PR SS 検証済の宣言を要求する (AC3)。
	// skip 条件 (UI 変更なし / 該当なし / 内部 refactor label) は全 lane 共通で優先。
	const isIntegrationLane = PR_LANE === 'integration';

	if (skipReason) {
		console.log(`[screenshot-check] ${skipReason} — SS 観点検証をスキップ (lane=${PR_LANE})`);
	} else if (isIntegrationLane) {
		// 統合 PR: before/after でなく VR 3 層 evidence を検証する (#2946 AC3)
		if (!hasIntegrationVrEvidence(PR_BODY)) {
			violations.push(buildIntegrationEvidenceMissingViolation());
		} else {
			console.log(
				'[screenshot-check] lane=integration — VR 3 層 evidence / 含有 PR SS 検証済の紐づけを確認 (before/after 4 スロットは不要、#2946)',
			);
		}
	} else {
		// feature / hotfix lane: 現行 (per-PR before/after) を完全維持 (#2946 AC4)
		// 検証 2: before/after ラベル検証 (#1740)
		const beforeAfterViolation = checkBeforeAfterViolation(PR_BODY);
		if (beforeAfterViolation) violations.push(beforeAfterViolation);

		// 検証 3: DOM スナップショット参照検証 (#1766 / #1747 AC4)
		const domViolation = checkDomSnapshotViolation(PR_BODY);
		if (domViolation) violations.push(domViolation);

		// 検証 4 / 5: 未来形記述 + embed 不在 (#2918 / #2929 項目 2)
		// pre-ready Step 11b (mainEmbedGate) と検出軸を収斂し「ローカル PASS ⊇ CI 検査軸」を双方向化する。
		// CI では SCREENSHOT_CHECK_MODE=warn の間は warning として記録され、error 昇格時に hard-fail に収斂する。
		if (hasFutureTenseScreenshotMarker(PR_BODY)) violations.push(buildFutureTenseViolation());
		if (!hasEmbeddedScreenshotImage(PR_BODY)) violations.push(buildEmbedMissingViolation());
	}

	// 結果出力
	if (violations.length === 0) {
		console.log('[screenshot-check] OK — 違反なし');
		return 0;
	}

	const isError = MODE === 'error';
	const prefix = isError ? '[screenshot-check] ERROR' : '[screenshot-check] WARN';

	for (const v of violations) {
		console.log(`\n${prefix} (${v.id}, ${v.issue}):`);
		console.log(v.message);
	}

	console.log(
		`\n[screenshot-check] mode=${MODE}, violations=${violations.length} ` +
			`(${isError ? 'CI を red にします' : '段階適用中: warning として記録、CI は通過させます (#1740 段階適用フラグ)'})`,
	);

	return isError ? 1 : 0;
}

/**
 * #2918: Ready 化前 SS embed ゲートの CLI エントリ。
 *
 * pre-ready Step から `SCREENSHOT_EMBED_GATE=1` env で起動される。UI 変更 + SS 未 embed /
 * 未来形記述を hard-fail (exit 1) する。検証ロジックは checkScreenshotEmbedReadiness に集約
 * (CI screenshot-check と同一 SSOT 関数を再利用)。
 *
 * @returns {number} exit code (0 = PASS / skip, 1 = 違反)
 */
function mainEmbedGate() {
	const { skipped, skipReason, violations } = checkScreenshotEmbedReadiness({
		body: PR_BODY,
		files: PR_FILES,
		labels: PR_LABELS,
	});

	if (skipped && violations.length === 0) {
		console.log(`[screenshot-embed-gate] ${skipReason} — SS embed 検証をスキップ`);
		return 0;
	}

	if (violations.length === 0) {
		console.log('[screenshot-embed-gate] OK — SS embed 済み (違反なし)');
		return 0;
	}

	for (const v of violations) {
		console.log(`\n[screenshot-embed-gate] ERROR (${v.id}, ${v.issue}):`);
		console.log(v.message);
	}
	console.log(
		`\n[screenshot-embed-gate] violations=${violations.length} — Ready 化前に SS embed を完了してください (#2918)`,
	);
	return 1;
}

import { resolve as pathResolve } from 'node:path';
// CLI 実行時のみ main を呼ぶ（テスト import 時は呼ばない）
// Windows では import.meta.url が file:///C:/... 形式、process.argv[1] が C:\... 形式になるため
// fileURLToPath で双方を絶対パスに正規化して比較する
import { fileURLToPath } from 'node:url';

const isMain = (() => {
	try {
		return pathResolve(fileURLToPath(import.meta.url)) === pathResolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	try {
		// #2918: SCREENSHOT_EMBED_GATE=1 で Ready 化前 SS embed ゲートを起動 (pre-ready Step 用)。
		// 未設定時は従来の CI screenshot-check (before/after / DOM / ローカルパス) を実行する。
		const runner =
			(process.env.SCREENSHOT_EMBED_GATE || '').toLowerCase() === '1' ||
			(process.env.SCREENSHOT_EMBED_GATE || '').toLowerCase() === 'true'
				? mainEmbedGate
				: main;
		process.exit(runner());
	} catch (err) {
		console.error('[screenshot-check] internal error:', err);
		process.exit(2);
	}
}
