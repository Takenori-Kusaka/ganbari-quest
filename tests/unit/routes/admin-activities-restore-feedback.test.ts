// tests/unit/routes/admin-activities-restore-feedback.test.ts (#4693 AC1、adversarial D2)
//
// **ファイル復元の結果表示は取込 feedback SSOT (`resolveImportFeedback`) を通す。**
//
// 旧実装の `handleRestoreSubmit` は `imported` / `skipped` だけを見て文言を組み立てていた:
//
//   imported === 0 && skipped > 0 ? restoreAllDuplicates : restoreSuccess(name, imported, skipped)
//
// このため、プラン上限で 119 件全部が弾かれたケース (imported=0 / skipped=0 / 理由は別 field)
// が success 側に落ち、「0 件を復元しました」と**成功トーン**で出ていた。AC1 が要求する
// 「上限で拒否され upsell 導線が出る」は、この経路では顧客に一度も見えていなかった。
// server 算出の `failed` (実 persist 失敗数) も同じ理由で無視されていた。
//
// 表示ロジックの中身は `tests/unit/marketplace/ui/import-feedback.test.ts` が検証する。
// ここでは「復元 handler がその SSOT を経由し、upgrade 導線を画面 state に反映する」配線を固定する。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE = readFileSync(
	join(REPO_ROOT, 'src/routes/(parent)/admin/activities/+page.svelte'),
	'utf-8',
);

/** `handleRestoreSubmit` の本体だけを切り出す (他 handler の記述に引っかからないため)。 */
function restoreHandlerSource(): string {
	const start = PAGE.indexOf('async function handleRestoreSubmit');
	expect(start).toBeGreaterThan(-1);
	const end = PAGE.indexOf('async function handleCopyFromChild');
	expect(end).toBeGreaterThan(start);
	return PAGE.slice(start, end);
}

describe('#4693 ファイル復元の結果表示', () => {
	it('imported / skipped から独自に文言を組み立てていない', () => {
		expect(restoreHandlerSource()).not.toContain('imported === 0 && skipped > 0');
	});

	it('取込 feedback SSOT (resolveImportFeedback) を経由する', () => {
		expect(restoreHandlerSource()).toContain('resolveImportFeedback');
	});

	it('上限が理由のときのアップグレード導線を画面 state に反映する', () => {
		expect(restoreHandlerSource()).toContain('actionUpgradeUrl = feedback.upgradeUrl');
	});
});
