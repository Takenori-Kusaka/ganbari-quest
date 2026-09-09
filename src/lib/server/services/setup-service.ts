import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { getAllChildren, getArchivedChildren } from '$lib/server/services/child-service';

/**
 * Returns true if the initial setup wizard has not been completed yet.
 * Setup is required when no children have ever been registered (active or archived).
 *
 * #783 で archive 機能が追加されたが、セットアップ判定はアーカイブ状態に
 * 依存すべきではない。子供が 1 人でも存在すれば（active/archived 問わず）
 * セットアップは完了とみなす。
 */
export async function isSetupRequired(tenantId: string): Promise<boolean> {
	try {
		const active = await getAllChildren(tenantId);
		if (active.length > 0) return false;
		const archived = await getArchivedChildren(tenantId);
		return archived.length === 0;
	} catch (err) {
		// DB スキーマ不整合（is_archived カラム未追加等）時はセットアップ済みと
		// みなしてリダイレクトループを防ぐ
		logger.warn('[SETUP] isSetupRequired failed, assuming setup done', {
			context: { tenantId, error: String(err) },
		});
		return false;
	}
}

/**
 * セットアップウィザードを歩いている最中かどうかの印 (#4860 must-B)。
 *
 * ウィザードは 9 step (children → questionnaire → packs → rewards → rules →
 * activities-defaults → challenges → first-adventure → complete) あるが、**step 1 で子供を 1 人登録した
 * 瞬間に `isSetupRequired` が false になる**。`hooks.server.ts` の「完了済みなら /setup を
 * ブロック」がそれを見ていたため、**残り 8 step が原理的に開けなかった** — step 1 の action が
 * `/setup/questionnaire` へ redirect しても、その先で `/` へ弾かれる (実測)。
 *
 * 「完了」の判定を子供の人数から切り離し、**ウィザードを歩き始めたか / 歩き終えたか**で持つ。
 * 既に子供が居て印を持たない既存テナントの挙動は変わらない (従来どおりブロック)。
 */
const WIZARD_IN_PROGRESS_KEY = 'setup_wizard_in_progress';

/** step 1 で最初の子供を登録したときに立てる。 */
export async function markSetupWizardStarted(tenantId: string): Promise<void> {
	try {
		await setSetting(WIZARD_IN_PROGRESS_KEY, 'true', tenantId);
	} catch (err) {
		// 印が立たなくても step 1 自体は成功させる (ウィザードが進めないだけで、データは入る)
		logger.warn('[SETUP] failed to mark wizard started', {
			context: { tenantId, error: String(err) },
		});
	}
}

/** `/setup/complete` に到達したら降ろす。以降 /setup は従来どおりブロックされる。 */
export async function clearSetupWizardInProgress(tenantId: string): Promise<void> {
	try {
		await setSetting(WIZARD_IN_PROGRESS_KEY, 'false', tenantId);
	} catch (err) {
		logger.warn('[SETUP] failed to clear wizard progress', {
			context: { tenantId, error: String(err) },
		});
	}
}

export async function isSetupWizardInProgress(tenantId: string): Promise<boolean> {
	try {
		return (await getSetting(WIZARD_IN_PROGRESS_KEY, tenantId)) === 'true';
	} catch (err) {
		// 読めないときは「歩いていない」に倒す = 従来どおりブロック (新しい穴を開けない)
		logger.warn('[SETUP] failed to read wizard progress', {
			context: { tenantId, error: String(err) },
		});
		return false;
	}
}

/**
 * `/setup/*` へのアクセスをブロックすべきか。
 *
 * hooks に直書きすると条件が test から見えないため、判定だけを切り出す
 * (`tests/unit/services/setup-wizard-reachability-4860.test.ts` が真理値表を固定する)。
 */
export function shouldBlockSetupAccess(input: {
	setupRequired: boolean;
	wizardInProgress: boolean;
}): boolean {
	if (input.setupRequired) return false; // まだ子供が居ない = ウィザードが必要
	return !input.wizardInProgress; // 歩いている最中だけ通す
}
