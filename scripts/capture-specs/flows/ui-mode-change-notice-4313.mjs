/**
 * scripts/capture-specs/flows/ui-mode-change-notice-4313.mjs (#4313)
 *
 * 誕生日で年齢帯 UI (uiMode) が切り替わったことを次回ログインで 1 回だけ告知する
 * ダイアログを 4 つの子供向け年齢モードで撮る。
 * `AUTH_MODE=local` (`npm run dev`) で動作。#4261 (habit-certificate-notice) と同じ
 * 「次回起動で 1 回だけ」パターンのため、同ファイル (`child-home-habit-notice-4261.mjs`)
 * の撮影方式を踏襲している。
 *
 * ## この画面が `DATA_SOURCE=demo` / `?screenshot=all` で撮れない理由 (#4332 QM follow-up)
 *
 * 3 つの制約が重なるため、既存の `child-home-per-child-pr2485.mjs` のような
 * demo fixture + `?screenshot=all` の定番パターンがそのまま使えない。
 *
 * 1. **`?screenshot=all` では意図的に非表示になる**: `dialog-state-machine.ts` を経由する
 *    自動トリガー系ダイアログは `isScreenshotMode` guard を持ち (`ui-mode-change-notice.ts`
 *    の `shouldShowUiModeChangeNotice`)、LP 配信 SS を汚さないようにこのダイアログを常に
 *    出さない設計になっている。→ **screenshot query を付けずに遷移する** (本ファイルの対応)
 * 2. **`DATA_SOURCE=demo` の settings write は no-op stub** (ADR-0048 §決定 §2、
 *    `src/lib/server/db/demo/settings-repo.ts`): 告知の実体は `settings` KV の
 *    `ui_mode_change_notice:<childId>` レコードであり、demo backend では書き込めない
 *    (`getSetting` は固定 fixture map からしか読めない)。→ **demo ではなく `AUTH_MODE=local`
 *    の実 sqlite (`data/ganbari-quest.db`) を使い、事前条件セクションの手順で実際に
 *    settings 行を挿入する** (本ファイルの対応)
 * 3. **demo fixture の `SiblingCheerOverlay` が常に最優先表示される**: demo の
 *    `DEMO_SIBLING_CHEERS` (`src/lib/server/demo/demo-data.ts`) は全ての demo 子供
 *    (902/903/904/906) に未読エールを持たせており、`zLayer="tutorial"` (`--z-tutorial=100`)
 *    が `--z-modal=50` より優先されるため、demo 経由だとこのダイアログより先に毎回
 *    エール受信演出が全面に出て閉じても再出現する (demo の cheer write も no-op stub の
 *    ため既読化されない)。→ **local mode + 空の DB なら未読エールは存在しないため
 *    そもそも発生しない** (制約 2 の対処と同時に解消される)
 *
 * ## 事前条件 (撮影者が用意する) — 実機で動作確認済みの手順 (2026-08-06)
 *
 * `npm run db:push` で新規 sqlite (`data/ganbari-quest.db`) を作った直後は `categories`
 * すら空なので、以下を **順番に** 満たす必要がある (足りない状態で試すと分かりにくい
 * 症状で詰まるため、検証済みの完全な組み合わせとして残す):
 *
 *   1. `categories` に最低 1 行 (`id=1` を使うなら `undou` 等)。
 *   2. `children`: id 1=preschool (from=baby) / 2=elementary (from=preschool) /
 *      3=junior (from=elementary) / 4=senior (from=junior)。
 *      `birthDate` は今日と一致しない値にする (誕生日ボーナスダイアログが同時に
 *      enqueue されると `birthdayPending` 排他でこの告知が出なくなるため、
 *      ADR-0012 ダイアログ 2 枚連続禁止)。
 *   3. **`child_activities` + `activity_logs` を子供ごとに最低 1 件ずつ。**
 *      これが無いと `hasAnyActivityRecords` が false → `data.isFirstTime` が true →
 *      `AdventureStartOverlay` (`dialog-state-machine.ts` の `PRIORITY_ORDER` で
 *      `uiModeChange` より優先) が `fsm.current` を握ったまま離さず、この告知は
 *      queue に積まれるだけで表示されない (DOM に `ui-mode-change-dialog` 自体が
 *      現れないため気づきにくい)。
 *   4. `settings`: `ui_mode_change_notice:<childId>` =
 *      {"from":"<切替前>","to":"<切替後=uiMode>","changedOn":"2026-08-06"}
 *      (JST 暦日文字列。値は `ui-mode-change-notice-service.ts` の
 *      `UiModeChangeNotice` 型と同じ shape)
 *   5. `settings`: `pin_gate_onboarding_seen` = 'true' (初回訪問 dialog を出さない)
 *
 * 上記 1〜5 を満たす投入スクリプトの例は本 PR の説明 (投入手順) を参照。better-sqlite3 +
 * drizzle で `db.insert(schema.<table>).values({...}).run()` を並べるだけで足りる。
 *
 * ## このフローが撮るもの
 *
 * 1 周目 (`after-*`) — pending がある回。ダイアログが出る
 * 2 周目 (`before-*`) — 同じ画面を再訪。**表示して閉じた時点で既読になっている**ため出ない
 *   (`?/dismissUiModeChangeNotice` action、= 修正前 / develop と同じ描画)
 *
 * 既読化 action のレスポンスを待ってから次へ進むため、固定待ちを使わずに
 * 2 周目の状態が決定的になる。
 *
 * 使用例:
 *   node scripts/capture.mjs --pr <N> \
 *     --flow ui-mode-change-notice-4313 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/ui-mode-change-notice-4313.mjs \
 *     --presets mobile
 */

const CHILDREN = [
	{ childId: 1, uiMode: 'preschool' },
	{ childId: 2, uiMode: 'elementary' },
	{ childId: 3, uiMode: 'junior' },
	{ childId: 4, uiMode: 'senior' },
];

const DIALOG = '[data-testid="ui-mode-change-dialog"]';
const CLOSE_BUTTON = '[data-testid="ui-mode-change-close-btn"]';

/**
 * 同じ flow を preset 違いで 2 回流すと step 名が衝突し、後の run が前の run の SS を
 * 上書きする (screenshots branch は file 名で同定する)。`CAPTURE_LABEL_SUFFIX` で分ける。
 */
const SUFFIX = process.env.CAPTURE_LABEL_SUFFIX ? `-${process.env.CAPTURE_LABEL_SUFFIX}` : '';

/** @param {import('playwright').Page} page */
async function selectChild(page, childId, uiMode) {
	// FlowRecorder の context は baseURL を持たないため絶対 URL で遷移する
	await page.goto(new URL('/switch', page.url()).href, { waitUntil: 'domcontentloaded' });
	await page.locator(`[data-testid="child-select-${childId}"]`).click();
	// 遷移完了後に waitForURL を呼ぶと取りこぼすため、home の testid 出現で待つ
	await page.locator(`[data-testid="${uiMode}-home-page"]`).waitFor({ state: 'visible' });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// デモ Cookie が残っていると isDemo=true になり child 一覧が空になる
	await page.context().clearCookies();
	// 本 PR の対象ではない使い方ガイドのバナーを画面から外す (localStorage 由来)
	await page.addInitScript(() => {
		try {
			for (const id of [1, 2, 3, 4]) localStorage.setItem(`child_tutorial_hint_shown_${id}`, '1');
		} catch {
			/* localStorage 不可の環境では何もしない */
		}
	});

	// 1 周目: pending あり → ダイアログが出る
	for (const { childId, uiMode } of CHILDREN) {
		await selectChild(page, childId, uiMode);
		await page.locator(DIALOG).waitFor({ state: 'visible' });
		await capture(`after-${uiMode}-home-mobile${SUFFIX}`);

		// 既読化が着地するまで待ってから閉じる (着地前に離脱すると 2 周目にまた出る)
		const dismissed = page.waitForResponse((r) => r.url().includes('dismissUiModeChangeNotice'));
		await page.locator(CLOSE_BUTTON).click();
		await dismissed;
	}

	// 2 周目: 既読化済 → 出ない (= 修正前と同じ描画 / 「1 回だけ」の実機証跡)
	for (const { childId, uiMode } of CHILDREN) {
		await selectChild(page, childId, uiMode);
		await page.locator(DIALOG).waitFor({ state: 'detached' });
		await capture(`before-${uiMode}-home-mobile${SUFFIX}`);
	}
};
