import { fail } from '@sveltejs/kit';
import { childAgeFromBirthDate } from '$lib/domain/child-age';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { formIdString } from '$lib/domain/form-value';
import { asCategoryId, asChildId } from '$lib/domain/ids';
import {
	ADMIN_CHILDREN_PAGE_LABELS,
	ADMIN_FORM_ERROR_LABELS,
	PLAN_GATE_LABELS,
} from '$lib/domain/labels';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getActivityLogs } from '$lib/server/services/activity-log-service';
import {
	addChild,
	editChild,
	getAllChildren,
	getArchivedChildren,
	removeChild,
} from '$lib/server/services/child-service';
import {
	applyRetentionFilter,
	checkChildLimit,
	getPlanLimits,
	hasArchivedData,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus, updateStatus } from '$lib/server/services/status-service';
import {
	activateVoice,
	deleteVoice,
	listVoices,
	uploadVoice,
} from '$lib/server/services/voice-service';
import type { Actions, PageServerLoad } from './$types';

// 年齢計算は domain SSOT (childAgeFromBirthDate) に委譲する (#4015 / #4718)。
// 旧実装は `new Date()` のローカル TZ getter で「今日」を決めており、Lambda (UTC) では
// JST 00:00〜09:00 に誕生日当日の年齢が 1 歳ずれていた。上限での丸めも同 SSOT が持つ
// (setup 側だけ丸めが無く、直せない欄を指すエラーを返していた、#4718 QM)。
function calculateAge(birthDate: string): number {
	return childAgeFromBirthDate(birthDate);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export const load: PageServerLoad = async ({ url, locals, parent }) => {
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const children = await getAllChildren(tenantId);
	const selectedId = url.searchParams.get('id');

	// #4708: 無料プランの上限で archive 中のお子さまを読み取り専用で一覧する (FAQ「管理画面で確認できる」)。
	// 件数は layout が配る archivedSummary (無料プランに戻ったときだけ計算) を見て、0 件なら読まない。
	const { archivedSummary } = await parent();
	const archivedChildren =
		archivedSummary.archivedChildCount > 0 ? await getArchivedChildren(tenantId) : [];

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
		const id = asChildId(selectedId);
		const child = children.find((c) => c.id === id);
		if (child) {
			const planTier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
			const retentionFilter = applyRetentionFilter(planTier);
			const [balance, status, logs, voices] = await Promise.all([
				getPointBalance(id, tenantId),
				getChildStatus(id, tenantId),
				getActivityLogs(id, tenantId, retentionFilter),
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
				achievements: [],
				voices,
			};
		}
	}

	// プラン制限情報
	const childLimit = await checkChildLimit(tenantId, licenseStatus);

	// アーカイブ検知（選択中の子供）
	const planTierForArchive = await resolveFullPlanTier(
		tenantId,
		licenseStatus,
		locals.context?.plan,
	);
	const planLimits = getPlanLimits(planTierForArchive);
	let archived = false;
	if (selectedChild && planLimits.historyRetentionDays !== null) {
		try {
			archived = await hasArchivedData(tenantId, selectedChild.id ?? 0, planTierForArchive);
		} catch {
			// アーカイブチェック失敗は無視
		}
	}

	return {
		children: childrenSummary,
		archivedChildren,
		selectedChild,
		childLimit,
		categoryDefs: CATEGORY_DEFS,
		archiveInfo: {
			hasArchived: archived,
			retentionDays: planLimits.historyRetentionDays,
		},
	};
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
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.nicknameRequired });
		}

		// 誕生日バリデーション
		if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.birthdayFormatInvalid });
		}
		if (birthDate && new Date(birthDate) > new Date()) {
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.birthdayFutureNotAllowed });
		}

		// 誕生日から年齢を自動計算、なければ手動入力 (#1380: 両方空はエラー)
		let age: number;
		if (birthDate) {
			age = calculateAge(birthDate);
		} else if (!ageStr) {
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.birthdayOrAgeRequired });
		} else {
			age = Number(ageStr);
			if (Number.isNaN(age) || age < 0 || age > 18) {
				return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.ageRange });
			}
		}

		// プラン制限チェック
		const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const childLimitCheck = await checkChildLimit(tenantId, licenseStatus);
		if (!childLimitCheck.allowed) {
			// #787: PlanLimitError 形式に統一。tier は memoize 済み (#788) なので 2 回目の呼び出しは安い
			const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
			return fail(403, {
				error: createPlanLimitError(
					tier,
					'standard',
					PLAN_GATE_LABELS.childLimitReached(childLimitCheck.max),
				),
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
		const childId = asChildId(formIdString(formData.get('childId')));
		const nickname = formData.get('nickname')?.toString().trim();
		const ageStr = formData.get('age')?.toString();
		const theme = formData.get('theme')?.toString();
		const birthDate = formData.get('birthDate')?.toString();

		if (!childId) {
			return fail(400, { error: ADMIN_FORM_ERROR_LABELS.idInvalid });
		}

		// 誕生日バリデーション
		if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.birthdayFormatInvalid });
		}
		if (birthDate && new Date(birthDate) > new Date()) {
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.birthdayFutureNotAllowed });
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

		// #4546 ③: 仮アバターの作り直しをレースで見送ったら画面で知らせる (黙って古いままにしない)。
		const { placeholderAvatarSkipped } = await editChild(childId, updates, tenantId);
		return { success: true, editedChildId: childId, placeholderAvatarSkipped };
	},

	removeChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = asChildId(formIdString(formData.get('childId')));

		if (!childId) {
			return fail(400, { error: ADMIN_FORM_ERROR_LABELS.idInvalid });
		}

		await removeChild(childId, tenantId);
		return { success: true, removedChildId: childId };
	},

	updateStatus: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const childId = asChildId(formIdString(form.get('childId')));
		const categoryId = asCategoryId(formIdString(form.get('categoryId')));
		const newValue = Number(form.get('value'));

		if (!childId || !categoryId) {
			return fail(400, { error: ADMIN_FORM_ERROR_LABELS.requiredFieldsMissing });
		}

		const currentStatus = await getChildStatus(childId, tenantId);
		if ('error' in currentStatus) {
			return fail(404, { error: ADMIN_FORM_ERROR_LABELS.childNotFoundNeutral });
		}

		if (Number.isNaN(newValue) || newValue < 0 || newValue > 100000) {
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.statusValueRange });
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
		const childId = asChildId(formIdString(formData.get('childId')));
		const file = formData.get('file');
		const label = String(formData.get('label') ?? '').trim();
		const durationMs = formData.get('durationMs') ? Number(formData.get('durationMs')) : undefined;

		if (!childId) return fail(400, { error: ADMIN_FORM_ERROR_LABELS.idInvalid });
		if (!label) return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.voiceLabelRequired });
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.voiceFileRequired });
		}

		const result = await uploadVoice(childId, tenantId, file, label, 'complete', durationMs);
		if ('error' in result) {
			const msgs: Record<string, string> = {
				INVALID_FILE: ADMIN_CHILDREN_PAGE_LABELS.voiceErrorInvalidFile,
				FILE_TOO_LARGE: ADMIN_CHILDREN_PAGE_LABELS.voiceErrorFileTooLarge,
				UNSUPPORTED_TYPE: ADMIN_CHILDREN_PAGE_LABELS.voiceErrorUnsupportedType,
				TOO_MANY_VOICES: ADMIN_CHILDREN_PAGE_LABELS.voiceErrorTooMany,
			};
			return fail(400, { error: msgs[result.error] ?? ADMIN_FORM_ERROR_LABELS.genericError });
		}
		return { success: true, voiceUploaded: true };
	},

	activateVoice: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const voiceId = formIdString(form.get('voiceId'));
		const childId = asChildId(formIdString(form.get('childId')));
		if (!voiceId || !childId) return fail(400, { error: ADMIN_FORM_ERROR_LABELS.idInvalid });

		await activateVoice(voiceId, childId, 'complete', tenantId);
		return { success: true, voiceActivated: true };
	},

	deleteVoice: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const voiceId = formIdString(form.get('voiceId'));
		if (!voiceId) return fail(400, { error: ADMIN_FORM_ERROR_LABELS.idInvalid });

		await deleteVoice(voiceId, tenantId);
		return { success: true, voiceDeleted: true };
	},

	updateBirthdayMultiplier: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const childId = asChildId(formIdString(form.get('childId')));
		const multiplier = Number(form.get('multiplier'));

		if (!childId) return fail(400, { error: ADMIN_FORM_ERROR_LABELS.idInvalid });
		if (Number.isNaN(multiplier) || multiplier < 0.5 || multiplier > 3.0) {
			return fail(400, { error: ADMIN_CHILDREN_PAGE_LABELS.birthdayMultiplierRange });
		}

		await editChild(childId, { birthdayBonusMultiplier: multiplier }, tenantId);
		return { success: true, multiplierUpdated: true, childId };
	},
};
