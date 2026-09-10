// /setup/first-adventure — はじめてのがんばり体験 (#0262 G4)
// セットアップの最終ステップ前に、子供と一緒に最初の活動記録を体験

import { fail, redirect } from '@sveltejs/kit';
import { formIdString } from '$lib/domain/form-value';
import { asActivityId, asChildId } from '$lib/domain/ids';
import {
	getSetupFirstAdventureRecordError,
	SETUP_FIRST_ADVENTURE_LABELS,
} from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { recordActivity } from '$lib/server/services/activity-log-service';
import { getChildActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);

	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	// PO 決裁 2026-09-10 決定 8: **だれと一緒にやるかを選ばせる**。
	// 旧実装は `children[0]` に固定しており、きょうだいがいる家庭では
	// 2 人目以降の保護者が「この子は無視されるのか」と受け取れた。
	// 選択は `?childId=` で持つ (活動は per-child なので、選び直したら一覧も入れ替わる)。
	const requestedChildId = url.searchParams.get('childId');
	const selectedChild = children.find((c) => String(c.id) === requestedChildId) ?? children[0];
	// redirect 済みなので children[0] は確実に存在
	if (!selectedChild) redirect(302, '/setup/children');
	// #2471: per-child API に絞り込み (selectedChild を持っているのに tenant 全 child の
	// activity を aggregate して filter していた点を是正)
	const activities = await getChildActivities(selectedChild.id, tenantId);

	// 子供の年齢に合う活動を3〜5件選ぶ
	// #2362 PR-3 Phase 7b-2c: ChildActivity は per-child instance のため、その子供向けに
	// 既に作成されている前提。ageMin/ageMax filter は不要 (削除済 fields)。
	const ageFiltered = activities.filter((a) => a.isVisible).slice(0, 5);

	// パックインポート結果を透過
	const imported = Number(url.searchParams.get('imported') ?? 0);
	const skipped = Number(url.searchParams.get('skipped') ?? 0);
	// #4868 adversarial: 直前の step (チャレンジ) の結果。旧実装は `challengesAdded` を
	// 付けて redirect しながら**どこでも読んでいなかった**ので、親は自分の操作が効いたのか
	// 分からなかった。`requested` が 0 (= 飛ばした) のときは何も出さない。
	const challengesRequested = Number(url.searchParams.get('challengesRequested') ?? 0);
	const challengesAdded = Number(url.searchParams.get('challengesAdded') ?? 0);
	// 「作れなかった」を「すでにある」と言い換えない (#4868 adversarial round 4)
	const challengesFailed = Number(url.searchParams.get('challengesFailed') ?? 0);

	return {
		child: selectedChild,
		// 決定 8: 2 人以上いるときだけ選択 UI を出す (1 人の家庭に選択肢を見せない)
		children: children.map((c) => ({ id: c.id, nickname: c.nickname })),
		activities: ageFiltered,
		imported,
		skipped,
		challengesRequested,
		challengesAdded,
		challengesFailed,
	};
};

export const actions: Actions = {
	record: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = asChildId(formIdString(formData.get('childId')));
		const activityId = asActivityId(formIdString(formData.get('activityId')));

		if (!childId || !activityId) {
			return fail(400, { error: SETUP_FIRST_ADVENTURE_LABELS.errorActivityRequired });
		}

		const result = await recordActivity(childId, activityId, tenantId);

		if ('error' in result) {
			// 理由 (同日 2 回目 / 上限 / 活動が消えた / 越境 childId) を捨てると、画面には
			// 「失敗しました」しか残らず、親は原因も次の一手も分からない
			// (ADR-0062 §1 状態起因 = Banner + 次アクション)。
			//
			// ADR-0062 §2 の後半 = 内部詳細は logger / 監視へ。画面には出さないコードを
			// ここに残さないと、サポートも事業計測も「なぜ最初の記録で詰まったか」を追えない。
			logger.warn('[SETUP] first adventure record failed', {
				service: 'setup-first-adventure',
				tenantId,
				context: {
					code: result.error,
					target: result.error === 'NOT_FOUND' ? result.target : undefined,
					activityId,
				},
			});
			trackSetupFunnel('setup_first_adventure_record_failed', tenantId, {
				code: result.error,
				target: result.error === 'NOT_FOUND' ? result.target : undefined,
			});
			return fail(400, { error: getSetupFirstAdventureRecordError(result) });
		}

		trackSetupFunnel('setup_first_adventure_completed', tenantId, {
			activityId,
			activityName: result.activityName,
			points: result.totalPoints,
		});

		return {
			success: true,
			activityName: result.activityName,
			totalPoints: result.totalPoints,
			levelUp: result.levelUp,
			unlockedAchievements: result.unlockedAchievements,
		};
	},

	skip: async ({ locals, url }) => {
		const tenantId = requireTenantId(locals);
		trackSetupFunnel('setup_first_adventure_skipped', tenantId);
		const imported = url.searchParams.get('imported') ?? '0';
		const skipped = url.searchParams.get('skipped') ?? '0';
		redirect(302, `/setup/complete?imported=${imported}&skipped=${skipped}`);
	},
};
