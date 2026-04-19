import type { LayoutServerLoad } from './$types';

/**
 * Root layout server load.
 *
 * #577: エラー画面 (`+error.svelte`) でロール別の挙動分岐を行うために、
 * `locals.context.role` と `locals.requestId` をクライアントに露出する。
 *
 * ここで返したデータは `$page.data` として全ページ・エラーページで参照できる。
 * 最小限の情報のみ露出すること（認証トークンや個人情報を含めない）。
 */
export const load: LayoutServerLoad = ({ locals }) => {
	return {
		role: locals.context?.role ?? null,
		requestId: locals.requestId ?? null,
		// ADR-0039 / #1180: デモ実行モードのフラグを全ページに配布。
		// DemoBanner / DemoGuideBar のマウント判定、CTA 文言切替、E2E 判定に使う。
		isDemo: locals.isDemo ?? false,
	};
};
