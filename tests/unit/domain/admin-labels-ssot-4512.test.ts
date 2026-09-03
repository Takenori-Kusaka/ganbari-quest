// tests/unit/domain/admin-labels-ssot-4512.test.ts
// #4512: admin 配下の UI 文言 SSOT 逸脱 (labels.ts / terms.ts を経由しない日本語直書き) の回帰固定。
//
// 背景: check-hardcoded-strings が #4322 で削除されて以降、この軸の機械強制はゼロで
// 「labels.ts に定義済みなのに画面側が同じ文字列を直書きしている」二重定義が admin 全域に蓄積した
// (docs/DESIGN.md §6 / ADR-0045、ルート CLAUDE.md §「機械強制が無くレビューで担保するもの」)。
//
// 本 test は 2 方向から固定する:
//   (A) 是正済みファイルに literal が戻ってきたら落ちる (source を読む regression guard)
//   (B) 集約先の label 値が変わっていない (本 PR は SSOT 集約であって文言変更ではない)
//
// 既存の labels-plan-literal-ratchet.test.ts (#3359) と同型の source 走査だが、
// 対象が plan 名 atom ではなく「admin 画面で直書きされていた表示文言」である点が異なる。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../../src/lib/domain/categories';
import {
	ADMIN_CHALLENGES_PAGE_LABELS,
	ADMIN_CHECKLISTS_PAGE_LABELS,
	ADMIN_FORM_ERROR_LABELS,
	CERTIFICATE_DETAIL_LABELS,
	CERTIFICATES_PAGE_LABELS,
	CHALLENGES_LABELS,
	CHEER_LABELS,
	formatMonthOnly,
	formatYearMonth,
	MEMBERS_LABELS,
	PLAN_GATE_LABELS,
	POINTS_LABELS,
	REPORTS_LABELS,
	SETTINGS_LABELS,
	STATUS_LABELS,
	UI_COMPONENTS_LABELS,
	UNRESOLVED_ENTITY_LABELS,
} from '../../../src/lib/domain/labels';
import { PLAN_TERMS, WEEKDAY_TERMS } from '../../../src/lib/domain/terms';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ADMIN = 'src/routes/(parent)/admin';

function read(relPath: string): string {
	return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

/**
 * (A) の走査対象から**コメントだけ**を落とした source を返す。
 *
 * 本 guard が禁じているのは「SSOT を経由しない**表示文言**」であって、開発者向けの注記ではない。
 * 是正の意図を説明するコメント (例: `<!-- #4665 F6: プラン表記は PAID_PLAN_LABEL が SSOT
 * (「スタンダード以上」直書きは表記ゆれ) -->`) やガイド anchor の由来コメントは、直書き文言を
 * 引用するのが自然であり、それを直書き扱いにすると「是正した理由を書けない」ことになる。
 *
 * 落とすのは以下 2 つだけで、判定は緩めない (markup / 属性 / 文字列リテラルは素通しのまま):
 *   - HTML コメント `<!-- ... -->` (svelte markup、複数行可)
 *   - 行全体がコメントの JS 行 (`//` 始まり / ブロックコメント始まり / jsdoc の `*` 継続行)
 *
 * 行末の trailing コメントは**あえて残す** (文字列中の `https://` を巻き込んで
 * 同一行の後続 literal を消す事故を避けるため。保守側に倒す)。
 */
function readCodeWithoutComments(relPath: string): string {
	return read(relPath)
		.replace(/<!--[\s\S]*?-->/g, '')
		.split(/\r?\n/)
		.filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
		.join('\n');
}

// ------------------------------------------------------------
// (A) 直書きが戻ってきたら落ちる regression guard
//
// 「その file にその文字列が現れてはいけない」の表。SSOT 側 (labels.ts / terms.ts) には当然
// 存在するため、対象は route file のみに絞る。
// ------------------------------------------------------------
const FORBIDDEN_LITERALS: ReadonlyArray<readonly [file: string, literals: readonly string[]]> = [
	[
		`${ADMIN}/activities/+page.server.ts`,
		[
			'IDが必要です',
			'名前を入力してください',
			'カテゴリを選択してください',
			'更新に失敗しました',
			'インポートに失敗しました',
			'カスタム活動は最大',
			'対象のお子さまを選択してください',
			'同じお子さまにはコピーできません',
		],
	],
	[
		`${ADMIN}/activities/+page.svelte`,
		// 「コピーが完了しました」は #4694 (develop) が固定文をやめ CHILD_COPY_RESULT_LABELS の
		// 件数付き結果文に置換したため、本表から外した (同 PR の説明コメントが旧文を引用しており、
		// 素の includes では実装ではなくコメントに当たってしまう)。結果文の固定は
		// tests/unit/domain/child-copy-result-labels.test.ts が担う。
		['違うお子さまを選んでください', '一括追加しました', '名前を入力してください'],
	],
	[`${ADMIN}/activities/[id]/edit/+page.server.ts`, ['不正な活動IDです', '活動が見つかりません']],
	[`${ADMIN}/certificates/+page.svelte`, ['連続記録', 'カテゴリマスター', '年間がんばり大賞']],
	[
		`${ADMIN}/certificates/[id]/+page.svelte`,
		['ダウンロードしました', 'ダウンロードに失敗しました', "'がんばりクエスト'"],
	],
	[
		`${ADMIN}/certificates/[id]/+page.server.ts`,
		['証明書が見つかりません', '子供が見つかりません'],
	],
	[`${ADMIN}/challenges/+page.server.ts`, ['IDが不正です']],
	[`${ADMIN}/challenges/+page.svelte`, ['が記録済み', '今日はまだ誰も記録していません']],
	[
		`${ADMIN}/checklists/+page.server.ts`,
		[
			'こどもを選択してください',
			'テンプレートIDが不正です',
			'アイテム名を入力してください',
			'時間帯が不正です',
			'プリセットIDが必要です',
			'配信先の同期に失敗しました',
			'復元したチェックリスト',
		],
	],
	[
		`${ADMIN}/cheer/+page.server.ts`,
		[
			'こどもを選択してください',
			'応援の理由を入力してください',
			'カテゴリを選択してください',
			'こどもが見つかりません',
			'エラーが発生しました',
			'の範囲で入力してください',
			'文字以内で入力してください',
		],
	],
	[`${ADMIN}/cheer/+page.svelte`, ["'うんどう'", 'ひとことメッセージを足す']],
	[
		`${ADMIN}/children/+page.server.ts`,
		[
			'ニックネームを入力してください',
			'誕生日の形式が正しくありません',
			'未来の日付は設定できません',
			'IDが不正です',
			'子供は最大',
			'MP3/M4A/WAV/WebM/OGG形式のみ',
		],
	],
	[`${ADMIN}/children/+page.svelte`, ['例: たろうくん']],
	[`${ADMIN}/growth-book/+page.svelte`, ['月`']],
	[`${ADMIN}/members/+page.svelte`, ["'7日間'", "'30日間'", "'無期限'"]],
	[`${ADMIN}/members/+page.server.ts`, ['(不明)']],
	[`${ADMIN}/points/+page.server.ts`, ['入力が不正です', 'ポイントは500単位で変換できます']],
	[`${ADMIN}/points/+page.svelte`, ['読み取りに失敗しました', '通信エラーが発生しました']],
	[
		`${ADMIN}/reports/+page.svelte`,
		['月曜日', '日曜日', '週次レポートを有効にする', '配信曜日', '年${'],
	],
	[`${ADMIN}/reports/+page.server.ts`, ['無効な曜日です']],
	[
		`${ADMIN}/settings/account/+page.svelte`,
		[
			'アカウントを削除します',
			'アカウント削除に失敗しました',
			'情報取得に失敗しました',
			'移譲先を選択',
			'移譲して退会',
			'処理中...',
			'変更中...',
		],
	],
	[
		`${ADMIN}/settings/account/+page.server.ts`,
		['すべてのフィールドを入力してください', 'が一致しません', 'が正しくありません'],
	],
	[
		`${ADMIN}/settings/activities/+page.svelte`,
		['ゆるやか', 'きびしめ', '減少しません', '"通貨"', 'レート（1P'],
	],
	[
		`${ADMIN}/settings/activities/+page.server.ts`,
		['子供IDが不正です', 'モードが不正です', '通貨コードが不正です'],
	],
	[
		`${ADMIN}/settings/data/+page.svelte`,
		['スタンダード以上', 'データクリア中', 'すべてのデータを削除', '確認のため'],
	],
	[
		`${ADMIN}/settings/data/+page.server.ts`,
		["'削除'", '同意チェックを入れてください', 'データクリアに失敗しました'],
	],
	[
		`${ADMIN}/settings/notifications/+page.svelte`,
		['リマインダー時刻', 'サイレント時間帯', 'この時間帯は通知を送信しません'],
	],
	[`${ADMIN}/settings/notifications/+page.server.ts`, ['時刻の形式が不正です']],
	[
		`${ADMIN}/settings/rules/+page.server.ts`,
		['ルール更新に失敗しました', 'ルール削除に失敗しました', 'プリセットIDが必要です'],
	],
	[
		`${ADMIN}/settings/support/+page.server.ts`,
		[
			'ご用件の選択が不正です',
			'内容を入力してください',
			'カテゴリが不正です',
			'機能要望',
			'バグ報告',
			'【お子さまの年齢】',
			'送信に失敗しました',
		],
	],
	[`${ADMIN}/status/+page.svelte`, ['同年齢の中でも特に活発です', '平均的なペースで', "+ '歳'"]],
	[
		`${ADMIN}/status/+page.server.ts`,
		['レベルが不正です', '称号は1〜20文字で入力してください', '必須項目が不足しています'],
	],
];

describe('#4512 (A) admin route の直書き復活を封じる', () => {
	for (const [file, literals] of FORBIDDEN_LITERALS) {
		it(`${file} に SSOT を経由しない表示文言が無い`, () => {
			const src = readCodeWithoutComments(file);
			const found = literals.filter((literal) => src.includes(literal));
			expect(
				found,
				`${file} に直書きが復活しています: ${found.join(' / ')}\n` +
					'labels.ts (compound) / terms.ts (atom) から参照してください (docs/DESIGN.md §6 / ADR-0045)。',
			).toEqual([]);
		});
	}
});

// ------------------------------------------------------------
// (B) 集約先の値が変わっていない (文言変更ではなく SSOT 集約であることの固定)
// ------------------------------------------------------------
describe('#4512 (B) 集約した label の値が変わっていない', () => {
	it('曜日名 atom は漢字フル形の 7 曜日', () => {
		expect(WEEKDAY_TERMS.monday).toBe('月曜日');
		expect(WEEKDAY_TERMS.sunday).toBe('日曜日');
		expect(Object.keys(WEEKDAY_TERMS)).toHaveLength(7);
		// admin/reports の配信曜日セレクトは本 atom を参照する (旧: 画面側で別に列挙)
		expect(REPORTS_LABELS.weeklySettingsDayNames.monday).toBe('月曜日');
	});

	it('reports の定義済み未使用ラベル 2 件が画面から参照されている', () => {
		const src = read(`${ADMIN}/reports/+page.svelte`);
		expect(REPORTS_LABELS.weeklySettingsEnableLabel).toBe('週次レポートを有効にする');
		expect(REPORTS_LABELS.weeklySettingsDayLabel).toBe('配信曜日');
		expect(src).toContain('REPORTS_LABELS.weeklySettingsEnableLabel');
		expect(src).toContain('REPORTS_LABELS.weeklySettingsDayLabel');
	});

	it('members の viewerDuration7d が画面から参照されている (旧: 直書きで未使用)', () => {
		const src = read(`${ADMIN}/members/+page.svelte`);
		expect(MEMBERS_LABELS.viewerDuration7d).toBe('7日間');
		expect(src).toContain('MEMBERS_LABELS.viewerDuration7d');
		expect(src).toContain('MEMBERS_LABELS.viewerDuration30d');
		expect(src).toContain('MEMBERS_LABELS.viewerDurationUnlimited');
	});

	it('「スタンダード以上」は 1 箇所 (PLAN_GATE_LABELS) から組み立てられる', () => {
		expect(PLAN_GATE_LABELS.standardOrAboveBadge).toBe(`${PLAN_TERMS.standard}以上`);
		// ヘッダーの premium バッジも同じ compound を参照する (旧: 別々に直書き)
		expect(UI_COMPONENTS_LABELS.headerPremiumTitle).toBe(PLAN_GATE_LABELS.standardOrAboveBadge);
	});

	it('証明書カテゴリ見出しは labels 側に移っても同じ 5 種', () => {
		// #4674 F5 が同じ 5 種を flat key (categoryStreak …) で先に集約済みのため、
		// merge 時に本 PR の categoryNames を削除しそちらへ寄せた (値は同一)。
		expect(CERTIFICATES_PAGE_LABELS.categoryStreak).toBe('🔥 連続記録');
		expect(CERTIFICATES_PAGE_LABELS.categoryLevel).toBe('🌟 レベルアップ');
		expect(CERTIFICATES_PAGE_LABELS.categoryMonthly).toBe('📜 月間がんばり');
		expect(CERTIFICATES_PAGE_LABELS.categoryMaster).toBe('🎓 カテゴリマスター');
		expect(CERTIFICATES_PAGE_LABELS.categoryAnnual).toBe('🏆 年間がんばり大賞');
		expect(CERTIFICATE_DETAIL_LABELS.shareCardBrandText).toBe('がんばりクエスト');
		expect(CERTIFICATE_DETAIL_LABELS.downloadSuccess).toBe('ダウンロードしました！');
	});

	it('cheer の上限メッセージは server 定数から組み立てても文面が同じ', () => {
		// 旧: labels 側は 1〜10000 / 100 文字を固定値で持ち、実際の表示は server が別に組んでいた
		expect(CHEER_LABELS.errorPointsRange(1, 10000)).toBe(
			'ポイントは1〜10000の範囲で入力してください',
		);
		expect(CHEER_LABELS.errorReasonTooLong(100)).toBe('理由は100文字以内で入力してください');
		expect(CHEER_LABELS.errorReasonRequired).toBe('応援の理由を入力してください');
		expect(CHEER_LABELS.errorCategoryRequired).toBe('カテゴリを選択してください');
	});

	it('cheer の既定カテゴリは categories.ts (SSOT) の値', () => {
		expect(CATEGORIES.undou.name).toBe('うんどう');
		expect(read(`${ADMIN}/cheer/+page.svelte`)).toContain('CATEGORIES.undou.name');
	});

	it('年月フォーマッタの出力が旧実装と一致する', () => {
		expect(formatYearMonth('2026', '08')).toBe('2026年8月');
		expect(formatYearMonth(2026, 8)).toBe('2026年8月');
		expect(formatMonthOnly('08')).toBe('8月');
	});

	it('共通 form エラーは CHILD_TERMS 由来の敬称を保つ', () => {
		expect(ADMIN_FORM_ERROR_LABELS.childRequiredHonorific).toBe('お子さまを選択してください');
		expect(ADMIN_FORM_ERROR_LABELS.targetChildRequired).toBe('対象のお子さまを選択してください');
		expect(ADMIN_FORM_ERROR_LABELS.sameChildNotAllowed).toBe('違うお子さまを選んでください');
		expect(ADMIN_FORM_ERROR_LABELS.someChildrenNotFound).toBe(
			'指定されたお子さまの一部が見つかりませんでした',
		);
		expect(ADMIN_FORM_ERROR_LABELS.childNotFoundNeutral).toBe('子供が見つかりません');
		expect(ADMIN_FORM_ERROR_LABELS.presetNotFoundNamed('abc')).toBe(
			'プリセット「abc」が見つかりません',
		);
	});

	// #4622 (develop) が同一文言を PLAN_GATE_LABELS に集約済みのため、#4512 側の重複定義は
	// merge 時に削除し、集約先の文面をここで pin する (二重定義を作り直さない)。
	it('プラン上限メッセージが旧実装と同じ文面になる', () => {
		expect(PLAN_GATE_LABELS.childLimitReached(3)).toBe(
			'子供は最大3人まで登録できます。プランをアップグレードしてください。',
		);
		expect(PLAN_GATE_LABELS.activityLimitReached(5)).toBe(
			'カスタム活動は最大5個まで作成できます。プランをアップグレードしてください。',
		);
	});

	it('画面固有ラベルの文面が変わっていない', () => {
		// #4671 F8 (develop) が同一文言を CHALLENGES_LABELS に集約済みのため、#4512 側の重複定義は
		// merge 時に削除し、集約先の文面をここで pin する (二重定義を作り直さない)。
		expect(CHALLENGES_LABELS.familyStreakRecordedToday(2)).toBe('今日は2人が記録済み');
		expect(CHALLENGES_LABELS.familyStreakNoneToday).toBe('今日はまだ誰も記録していません');
		expect(ADMIN_CHALLENGES_PAGE_LABELS.deleteChildButton('たろう')).toBe('たろう を削除');
		expect(ADMIN_CHECKLISTS_PAGE_LABELS.copyAlreadyDistributedNote(3)).toBe(
			'（3 件はすでに配信済みでした）',
		);
		expect(STATUS_LABELS.analysisHigh).toBe('同年齢の中でも特に活発です');
		expect(POINTS_LABELS.convertAmountNotInteger).toBe('ポイントは整数で入力してください');
		expect(UNRESOLVED_ENTITY_LABELS.email).toBe('(不明)');
	});

	it('確認テキストの合言葉は画面と server で同じ定数を見る', () => {
		// 旧: 画面 (placeholder / 判定) と server (検証) が '削除' / 'アカウントを削除します' を
		// 別々に直書きしており、合言葉を変えると「入力しても通らない」状態になり得た。
		expect(SETTINGS_LABELS.clearConfirmKeyword).toBe('削除');
		expect(SETTINGS_LABELS.clearConfirmFieldLabel).toContain(SETTINGS_LABELS.clearConfirmKeyword);
		expect(SETTINGS_LABELS.clearConfirmRequired).toContain(SETTINGS_LABELS.clearConfirmKeyword);
		expect(read(`${ADMIN}/settings/data/+page.server.ts`)).toContain(
			'SETTINGS_LABELS.clearConfirmKeyword',
		);

		expect(SETTINGS_LABELS.accountDeleteConfirmKeyword).toBe('アカウントを削除します');
		expect(SETTINGS_LABELS.accountDeleteConfirmFieldLabel).toContain(
			SETTINGS_LABELS.accountDeleteConfirmKeyword,
		);
	});
});
