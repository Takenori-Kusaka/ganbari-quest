// tests/unit/architecture/irreversible-warning-alert-fitness.test.ts
//
// #4545: 不可逆操作 (物理削除 / 猶予なし退会 / 保持期間短縮) の直前に出す最重要警告が、
// **色文字だけ**で表現されて顧客に届かなくなる class を lock する fitness function。
//
// 背景 (root class): 文言 (labels.ts) の正しさは #4517 / #4529 / #4531 で直ったが、
// 提示形式 (primitive / role / 縦位置) には規約も検査も無く、
//   - `<p class="text-[var(--color-feedback-error-text)]">` の色文字だけ (枠線 / 背景 / アイコン無し)
//   - `role="alert"` 無し (支援技術に「警告」として伝わらない)
// のまま放置されていた。色だけを手がかりにする表現は色覚多様性のある方に届かない
// (WCAG 1.4.1 Use of Color)。
//
// 本 test は「登録された不可逆警告のラベルは Alert primitive の内側で描画されること」を assert する。
// Alert (`variant="danger"`) が枠線 + 背景 + アイコン + `role="alert"` をまとめて担保するため、
// 個別 file で色文字に戻す改修は必ずここで落ちる。
//
// 縦位置 (スクロールせずに読める位置にあること) は DOM 順序の話なので本 test では見ない。
// `DowngradeResourceSelector.stories.svelte` の play 関数が assert する (両輪)。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../..');

/**
 * 不可逆警告の registry (SSOT)。
 *
 * 新しく「取り消せない操作の直前に出す警告」を追加したら、ここに 1 行足す。
 * 足さないと検査対象にならないが、足したうえで色文字に戻すと本 test が落ちる。
 */
const IRREVERSIBLE_WARNINGS: Array<{ file: string; labelRef: string; why: string }> = [
	{
		file: 'src/routes/(parent)/admin/settings/account/+page.svelte',
		labelRef: 'SETTINGS_LABELS.accountDeleteOwnerWarning',
		why: 'オーナー退会 = 家族グループ全データの物理削除 (復旧不能)',
	},
	{
		file: 'src/routes/(parent)/admin/settings/account/+page.svelte',
		labelRef: 'SETTINGS_LABELS.accountDeleteChildWarning',
		why: '子供アカウント削除 = ログイン情報の削除 (復旧不能)',
	},
	{
		file: 'src/routes/(parent)/admin/settings/account/+page.svelte',
		labelRef: 'SETTINGS_LABELS.accountDeleteMemberWarning',
		why: 'メンバー退会 = ログイン情報の削除 (復旧不能)',
	},
	{
		file: 'src/routes/(parent)/admin/settings/account/+page.svelte',
		labelRef: 'SETTINGS_LABELS.accountDeleteGraceNotice',
		why: '無料プランは猶予 0 日 = 申込と同時に物理削除され取り消せない (DELETION_GRACE_PERIOD_DAYS.free = 0)',
	},
	{
		file: 'src/lib/features/admin/components/DowngradeResourceSelector.svelte',
		labelRef: 'L.retentionWarning',
		why: '保持期間を超えた記録は物理削除され、再契約でも戻らない',
	},
	{
		file: 'src/lib/features/admin/components/ChildProfileCard.svelte',
		labelRef: 'CHILD_PROFILE_CARD_LABELS.deleteConfirmText',
		why: '子供の削除 (プロフィール + 紐づく記録の消失)',
	},
];

/** `index` の位置が `<Alert ...>` 〜 `</Alert>` の内側かを判定する。 */
function isInsideAlert(source: string, index: number): boolean {
	const lastOpen = source.lastIndexOf('<Alert', index);
	if (lastOpen === -1) return false;
	const lastClose = source.lastIndexOf('</Alert>', index);
	// 直近の <Alert が 直近の </Alert> より後 = まだ閉じていない Alert の内側
	return lastOpen > lastClose;
}

describe('#4545 不可逆警告は Alert primitive で出す (色文字だけにしない)', () => {
	for (const { file, labelRef, why } of IRREVERSIBLE_WARNINGS) {
		it(`${file} の ${labelRef} は Alert の内側で描画される (${why})`, () => {
			const source = readFileSync(join(REPO_ROOT, file), 'utf8');

			const occurrences: number[] = [];
			let from = 0;
			for (;;) {
				const index = source.indexOf(labelRef, from);
				if (index === -1) break;
				occurrences.push(index);
				from = index + labelRef.length;
			}

			// registry が腐って対象が消えていたら silent pass させない
			expect(
				occurrences.length,
				`${labelRef} が ${file} に見つからない。ラベルを rename / 削除したなら registry も更新すること`,
			).toBeGreaterThan(0);

			const outside = occurrences.filter((index) => !isInsideAlert(source, index));
			expect(
				outside,
				`${labelRef} が Alert の外で描画されている (色文字だけの警告は色覚多様性のある方に届かない)。` +
					'$lib/ui/primitives/Alert.svelte の variant="danger" を使うこと',
			).toEqual([]);
		});
	}

	it('Alert primitive は danger variant に role="alert" を割り当てる (上の検査が意味を持つ前提)', () => {
		const alertSource = readFileSync(join(REPO_ROOT, 'src/lib/ui/primitives/Alert.svelte'), 'utf8');
		// role={variant === 'danger' ? 'alert' : 'status'} の形を要求する
		expect(alertSource).toMatch(/role=\{variant === 'danger' \? 'alert' :/);
	});
});
