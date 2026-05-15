// src/routes/api/demo/exit/+server.ts
//
// ADR-0039 Phase 2 完遂 (#2097, 2026-05-15): デモ退出エンドポイント。
// Phase 1 までは hooks.server.ts で path `/demo/exit` を直接処理していたが、
// `src/routes/demo/**` 削除と同期して `/api/demo/exit` に正式エンドポイント化。
//
// `gq_demo` cookie および `gq_demo_plan` cookie を削除し、本番モードに戻す。
// LP / SS script / ブックマーク経路の保護のため、hooks 側で `/demo/exit` →
// `/api/demo/exit` の 302 redirect を入れて互換性を維持している。

import { redirect } from '@sveltejs/kit';
import { DEMO_MODE_COOKIE } from '$lib/server/demo/demo-mode';
import { DEMO_PLAN_COOKIE } from '$lib/server/demo/demo-plan';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ cookies, url }) => {
	cookies.delete(DEMO_MODE_COOKIE, { path: '/' });
	cookies.delete(DEMO_PLAN_COOKIE, { path: '/' });
	// 退出後の遷移先を query で受け取れるようにする。デフォルトは LP top。
	const next = url.searchParams.get('next') ?? '/';
	throw redirect(302, next);
};

export const POST: RequestHandler = ({ cookies, url }) => {
	cookies.delete(DEMO_MODE_COOKIE, { path: '/' });
	cookies.delete(DEMO_PLAN_COOKIE, { path: '/' });
	const next = url.searchParams.get('next') ?? '/';
	throw redirect(302, next);
};
