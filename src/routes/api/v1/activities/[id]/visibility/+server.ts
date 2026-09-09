import { json } from '@sveltejs/kit';
import { asActivityId } from '$lib/domain/ids';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { notFound, validationError } from '$lib/server/errors';
import { getActivityById, setActivityVisibility } from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	// **`DELETE /api/v1/activities/[id]` と同じ状態変更の第 2 の入口**。
	//
	// DELETE 側は `setActivityVisibility(id, false)` を呼ぶ「非表示にする」操作で、
	// そちらだけ親限定にしても、この route から `{ isVisible: false }` を送れば同じ結果になる。
	// 片方だけ閉じるのは閉じたことにならないので、同じ線でここも閉じる
	// (同じ service を呼ぶ route が揃って親限定であることは
	//  `tests/unit/architecture/parent-only-service-second-door.test.ts` が機械で見る)。
	//
	// 読み取りは閉じない方針だが、この route は PATCH しか持たない。
	// role 判定はルート横断の唯一の seam (`requireRole`) 経由にする
	// (#3528 / 14-セキュリティ設計書 §5.2.3 §5.2.5。ハンドラ内の ad-hoc 判定は置かない)。
	const gate = parentGateResponse(locals);
	if (gate) return gate;
	const tenantId = context.tenantId;
	const id = asActivityId(params.id);
	if (!id) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	const body = await request.json();
	if (typeof body.isVisible !== 'boolean') {
		return validationError('isVisible は true/false で指定してください');
	}

	const updated = await setActivityVisibility(id, body.isVisible, tenantId);
	return json(updated);
};
