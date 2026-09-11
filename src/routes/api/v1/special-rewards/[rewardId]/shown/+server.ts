import { error, json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
import { markRewardShown } from '$lib/server/services/special-reward-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals, cookies }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const rewardId = params.rewardId;
	if (!rewardId) {
		error(400, 'Invalid reward ID');
	}

	// #2845 課題①: 呼び出し元は子供ホーム (selectedChildId cookie 必須)。childId を repo まで
	// 引き回し、(childId, rewardId) 複合キーで所有権を検証する (id-only mutation 禁止)。
	const childId = asChildId(cookies.get('selectedChildId') ?? '');
	if (!childId) {
		error(400, 'Child not selected');
	}
	// cookie は client が書き換えられる。child ロールが兄弟の childId を cookie に入れて
	// 兄弟のごほうび演出を消費するのを止める。
	requireChildAccess(locals, childId);

	const success = await markRewardShown(childId, rewardId, tenantId);
	if (!success) {
		error(404, 'Reward not found');
	}

	return json({ success: true });
};
