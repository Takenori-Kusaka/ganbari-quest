// src/routes/ops/license/legacy-count/+server.ts
// #2484 (HMAC migration Phase 1.3): legacy 形式ライセンスキー残存数 ops 集計 endpoint
//
// 認証: `/ops/+layout.server.ts` で isOpsMember(locals.identity) gate 適用済み (Cognito ops group)
// 用途: docs/operations/license-hmac-migration-plan.md §4 Phase 1 — Phase 2/3 移行判断材料の取得
// backend: DynamoDB のみ実 count (SaaS 限定、migration plan §4 line 90)、SQLite は no-op で 0

import { json } from '@sveltejs/kit';
import { getRepos } from '$lib/server/db/factory';
import { getEnv } from '$lib/runtime/env';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const dataSource = getEnv().DATA_SOURCE;
	const backend = dataSource === 'dynamodb' ? 'dynamodb' : 'sqlite';

	const legacyCount = await getRepos().auth.countLicenseKeys({ format: 'legacy' });

	return json({
		legacyCount,
		queriedAt: new Date().toISOString(),
		backend,
	});
};
