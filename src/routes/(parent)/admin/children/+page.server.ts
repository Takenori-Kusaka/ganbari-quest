import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getChildAchievements } from '$lib/server/services/achievement-service';
import { getActivityLogs } from '$lib/server/services/activity-log-service';
import {
	addChild,
	editChild,
	getAllChildren,
	removeChild,
} from '$lib/server/services/child-service';
import { checkChildLimit } from '$lib/server/services/plan-limit-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus, updateStatus } from '$lib/server/services/status-service';
import {
	activateVoice,
	deleteVoice,
	listVoices,
	uploadVoice,
} from '$lib/server/services/voice-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

function calculateAge(birthDate: string): number {
	const birth = new Date(birthDate);
	const today = new Date();
	let age = today.getFullYear() - birth.getFullYear();
	const monthDiff = today.getMonth() - birth.getMonth();
	if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
		age--;
	}
	return Math.max(0, Math.min(18, age));
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	const selectedId = url.searchParams.get('id');

	const childrenSummary = await Promise.all(
		children.map(async (child) => {
			const balance = await getPointBalance(child.id, tenantId);
			const status = await getChildStatus(child.id, tenantId);
			if ('error' in balance) {
				logger.warn('[admin/children] ポイント取得フォールバック', {
					context: { childId: child.id, error: balance.error },
				});
			}
			if ('error' in status) {
				logger.warn('[admin/children] ステータス取得フォールバック', {
					context: { childId: child.id, error: status.error },
				});
			}
			return {
				...child,
				balance: 'error' in balance ? 0 : balance.balance,
				level: 'error' in status ? 1 : status.level,
				levelTitle: 'error' in status ? '' : status.levelTitle,
			};
		}),
	);

	let selectedChild = null;
	if (selectedId) {
		const id = Number(selectedId);
		const child = children.find((c) => c.id === id);
		if (child) {
			const [balance, status, logs, achievements, voices] = await Promise.all([
				getPointBalance(id, tenantId),
				getChildStatus(id, tenantId),
				getActivityLogs(id, tenantId),
				getChildAchievements(id, tenantId),
				listVoices(id, 'complete', tenantId),
			]);

			if ('error' in balance) {
				logger.warn('[admin/children] 詳細ポイント取得フォールバック', {
					context: { childId: id, error: balance.error },
				});
			}
			if ('error' in status) {
				logger.warn('[admin/children] 詳細ステータス取得フォールバック', {
					context: { childId: id, error: status.error },
				});
			}

			selectedChild = {
				...child,
				balance: 'error' in balance ? null : balance,
				status: 'error' in status ? null : status,
				recentLogs: 'error' in logs ? [] : logs.logs.slice(0, 20),
				logSummary: 'error' in logs ? null : logs.summary,
				achievements: achievements,
				voices,
			};
		}
	}

	// プラン制限情報
	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const childLimit = await checkChildLimit(tenantId, licenseStatus);

	return { children: childrenSummary, selectedChild, childLimit, categoryDefs: CATEGORY_DEFS };
};

export const actions: Actions = {
	addChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const nickname = formData.get('nickname')?.toString().trim();
		const ageStr = formData.get('age')?.toString();
		const theme = formData.get('theme')?.toString() || 'pink';
		const birthDate = formData.get('birthDate')?.toString() || null;

		if (!nickname || nickname.length === 0) {
			return fail(400, { error: 'ニックネームを入力してください' });
		}

		// 誕生日バリデーション
		if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
			return fail(400, { error: '誕生日の形式が正しくありません（YYYY-MM-DD）' });
		}
		if (birthDate && new Date(birthDate) > new Date()) {
			return fail(400, { error: '未来の日付は設定できません' });
		}

		// 誕生日から年齢を自動計算、なければ手動入力
		let age: number;
		if (birthDate) {
			age = calculateAge(birthDate);
		} else {
			age = Number(ageStr);
			if (Number.isNaN(age) || age < 0 || age > 18) {
				return fail(400, { error: '年齢は0〜18で入力してください' });
			}
		}

		// プラン制限チェック
		const licenseStatus = locals.context?.licenseStatus ?? 'none';
		const childLimitCheck = await checkChildLimit(tenantId, licenseStatus);
		if (!childLimitCheck.allowed) {
			return fail(403, {
				error: `子供は最大${childLimitCheck.max}人まで登録できます。プランをアップグレードしてください。`,
			});
		}

		const child = await addChild(
			{ nickname, age, theme, birthDate: birthDate ?? undefined },
			tenantId,
		);
		return { success: true, addedChild: child };
	},

	editChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const nickname = formData.get('nickname')?.toString().trim();
		const ageStr = formData.get('age')?.toString();
		const theme = formData.get('theme')?.toString();
		const birthDate = formData.get('birthDate')?.toString();

		if (Number.isNaN(childId)) {
			return fail(400, { error: 'IDが不正です' });
		}

		// 誕生日バリデーション
		if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
			return fail(400, { error: '誕生日の形式が正しくありません（YYYY-MM-DD）' });
		}
		if (birthDate && new Date(birthDate) > new Date()) {
			return fail(400, { error: '未来の日付は設定できません' });
		}

		const updates: Record<string, string | number | null> = {};
		if (nickname && nickname.length > 0) updates.nickname = nickname;
		if (theme) updates.theme = theme;

		// 誕生日 → 年齢自動計算
		if (birthDate !== undefined) {
			updates.birthDate = birthDate || null;
			if (birthDate) {
				updates.age = calculateAge(birthDate);
			} else {
				// 誕生日をクリアした場合は手動年齢を使う
				const age = Number(ageStr);
				if (!Number.isNaN(age) && age >= 0 && age <= 18) updates.age = age;
			}
		} else {
			const age = Number(ageStr);
			if (!Number.isNaN(age) && age >= 0 && age <= 18) updates.age = age;
		}

		await editChild(childId, updates, tenantId);
		return { success: true, editedChildId: childId };
	},

	removeChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));

		if (Number.isNaN(childId)) {
			return fail(400, { error: 'IDが不正です' });
		}

		await removeChild(childId, tenantId);
		return { success: true, removedChildId: childId };
	},

	updateStatus: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const childId = Number(form.get('childId'));
		const categoryId = Number(form.get('categoryId'));
		const newValue = Number(form.get('value'));

		if (!childId || !categoryId) {
			return fail(400, { error: '必須項目が不足しています' });
		}

		const currentStatus = await getChildStatus(childId, tenantId);
		if ('error' in currentStatus) {
			return fail(404, { error: '子供が見つかりません' });
		}

		if (Number.isNaN(newValue) || newValue < 0 || newValue > 100000) {
			return fail(400, { error: '値は0〜100000の範囲で入力してください' });
		}

		const currentValue = currentStatus.statuses[categoryId]?.value ?? 0;
		const changeAmount = newValue - currentValue;

		if (changeAmount === 0) {
			return { success: true, noChange: true };
		}

		await updateStatus(childId, categoryId, changeAmount, 'admin_edit', tenantId);
		return { success: true, statusUpdated: true };
	},

	uploadVoice: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const file = formData.get('file');
		const label = String(formData.get('label') ?? '').trim();
		const durationMs = formData.get('durationMs') ? Number(formData.get('durationMs')) : undefined;

		if (!childId) return fail(400, { error: 'IDが不正です' });
		if (!label) return fail(400, { error: 'ラベルを入力してください' });
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: '音声ファイルを選択してください' });
		}

		const result = await uploadVoice(childId, tenantId, file, label, 'complete', durationMs);
		if ('error' in result) {
			const msgs: Record<string, string> = {
				INVALID_FILE: 'ファイルが不正です',
				FILE_TOO_LARGE: '5MB以下にしてください',
				UNSUPPORTED_TYPE: 'MP3/M4A/WAV/WebM/OGG形式のみ',
				TOO_MANY_VOICES: '10件まで登録可能です',
			};
			return fail(400, { error: msgs[result.error] ?? 'エラーが発生しました' });
		}
		return { success: true, voiceUploaded: true };
	},

	activateVoice: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const voiceId = Number(form.get('voiceId'));
		const childId = Number(form.get('childId'));
		if (!voiceId || !childId) return fail(400, { error: 'IDが不正です' });

		await activateVoice(voiceId, childId, 'complete', tenantId);
		return { success: true, voiceActivated: true };
	},

	deleteVoice: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const voiceId = Number(form.get('voiceId'));
		if (!voiceId) return fail(400, { error: 'IDが不正です' });

		await deleteVoice(voiceId, tenantId);
		return { success: true, voiceDeleted: true };
	},

	updateBirthdayMultiplier: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const childId = Number(form.get('childId'));
		const multiplier = Number(form.get('multiplier'));

		if (Number.isNaN(childId)) return fail(400, { error: 'IDが不正です' });
		if (Number.isNaN(multiplier) || multiplier < 0.5 || multiplier > 3.0) {
			return fail(400, { error: '倍率は0.5〜3.0の範囲で設定してください' });
		}

		await editChild(childId, { birthdayBonusMultiplier: multiplier }, tenantId);
		return { success: true, multiplierUpdated: true, childId };
	},
};
