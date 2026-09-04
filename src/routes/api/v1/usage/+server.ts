// src/routes/api/v1/usage/+server.ts
// 使用時間ログ API (#1292)
//
// #2338 (2026-05-20): 本番 cognito Lambda (DATA_SOURCE=dynamodb) で SQLite import 失敗時
// graceful degradation。null 戻り値は 500 ではなく 204 No Content で返す
// (client は fire-and-forget なので body 不要、CloudWatch 5xx alarm を抑止)。
// Pre-PMF 判断: ADR-0010 Bucket B。詳細: docs/rationale/07-usage-log-dynamodb-deferred-rationale.md

import { json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
import { endUsageSession, startUsageSession } from '$lib/server/services/usage-log-service';
import type { RequestHandler } from './$types';

/** POST /api/v1/usage — セッション開始を記録 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const { tenantId } = context;

	const body = await request.json().catch(() => null);
	const rawChildId: unknown = body?.childId;
	// #3575: id は opaque string。旧クライアントの number も境界で受けて as* 変換する
	if (
		rawChildId == null ||
		!(typeof rawChildId === 'string' || typeof rawChildId === 'number') ||
		rawChildId === ''
	) {
		return json({ error: 'childId が必要です' }, { status: 400 });
	}
	const childId = asChildId(rawChildId);
	// childId は **body** で来る。child ロールが兄弟の利用時間ログを汚すのを止める
	// (自動スリープ #1292 の判定材料であり、他人の休憩タイミングを動かせてしまう)。
	requireChildAccess(locals, childId);

	const result = await startUsageSession(tenantId, childId);
	if (result === null) {
		// #2338: DB エラー時は 500 ではなく 204 No Content
		// (client は fire-and-forget、5xx alarm 抑止のため)
		return new Response(null, { status: 204 });
	}

	return json({ id: result.id }, { status: 201 });
};

/** PATCH /api/v1/usage — セッション終了を記録 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const { tenantId } = context;

	const body = await request.json().catch(() => null);
	const rawId: unknown = body?.id;
	if (rawId == null || !(typeof rawId === 'string' || typeof rawId === 'number') || rawId === '') {
		return json({ error: 'id が必要です' }, { status: 400 });
	}
	const id = String(rawId);
	// #2338: id === 0 は no-op fallback の dummy id (DATA_SOURCE=dynamodb / demo)。
	// service 層 endUsageSession() 内で no-op 判定し durationSec: 0 を返す。
	const result = await endUsageSession(id, tenantId);
	if (result === null) {
		// #2338: DB エラー時は 500 ではなく 204 No Content
		return new Response(null, { status: 204 });
	}

	return json({ durationSec: result.durationSec }, { status: 200 });
};
