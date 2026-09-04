import { json } from '@sveltejs/kit';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
import { validationError } from '$lib/server/errors';
import { executeDailyBattle, getTodayBattle } from '$lib/server/services/battle-service';
import { getChildById } from '$lib/server/services/child-service';
import { getChildStatus } from '$lib/server/services/status-service';
import type { RequestHandler } from './$types';

interface BattleContext {
	tenantId: string;
	childId: ChildId;
	uiMode: string;
	categoryXp: Record<string, number>;
}

/** childId パース → 子供取得 → ステータス取得 → カテゴリXP算出 の共通処理 */
async function resolveChildBattleContext(
	params: { childId: string },
	locals: App.Locals,
): Promise<BattleContext | Response> {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.childId);
	if (!childId) return validationError('IDが不正です');
	// GET / POST 双方がこの共通処理を通るため、ここ 1 箇所で兄弟のバトル閲覧・実行を止める。
	requireChildAccess(locals, childId);

	const child = await getChildById(childId, tenantId);
	if (!child) return validationError('子供が見つかりません');

	const statusResult = await getChildStatus(childId, tenantId);
	if ('error' in statusResult) {
		return validationError('ステータスが見つかりません');
	}

	const categoryXp: Record<string, number> = {};
	for (const [catId, detail] of Object.entries(statusResult.statuses)) {
		categoryXp[catId] = detail.value;
	}

	const uiMode = child.uiMode ?? 'preschool';
	return { tenantId, childId, uiMode, categoryXp };
}

/** GET: 今日のバトル情報を取得 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const ctx = await resolveChildBattleContext(params, locals);
	if (ctx instanceof Response) return ctx;

	const battle = await getTodayBattle(ctx.childId, ctx.uiMode, ctx.categoryXp, ctx.tenantId);
	return json(battle);
};

/** POST: バトルを実行（サーバ側で今日のバトルを再取得して検証） */
export const POST: RequestHandler = async ({ params, locals }) => {
	const ctx = await resolveChildBattleContext(params, locals);
	if (ctx instanceof Response) return ctx;

	try {
		const result = await executeDailyBattle(ctx.childId, ctx.uiMode, ctx.categoryXp, ctx.tenantId);
		return json(result);
	} catch (e) {
		return validationError(e instanceof Error ? e.message : 'バトル実行に失敗しました');
	}
};
