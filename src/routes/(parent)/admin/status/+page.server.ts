import { fail } from '@sveltejs/kit';
import { formIdString } from '$lib/domain/form-value';
import { asCategoryId, asChildId } from '$lib/domain/ids';
// #4512: form action のエラー文言は labels SSOT 経由 (docs/DESIGN.md §6 / ADR-0045)
import { ADMIN_FORM_ERROR_LABELS, STATUS_LABELS } from '$lib/domain/labels';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { isOpsMember, requireGlobalMasterWriteAccess } from '$lib/server/auth/ops-authz';
import { findAllBenchmarks, upsertBenchmark } from '$lib/server/db/status-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	getBenchmarkValues,
	getChildStatus,
	getLevelTitleList,
	getMonthlyComparison,
	resetAllLevelTitles,
	resetLevelTitle,
	saveLevelTitle,
} from '$lib/server/services/status-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);
	// #3824 (QM Tier2 H1): benchmark (market_benchmarks = 全テナント共有グローバル master) の
	// 編集 UI は書込 authz (requireGlobalMasterWriteAccess) と同一境界で出し分ける。
	//   parent-admin に編集フォームを描画すると、保存時 server が 403 を返し「見えるが必ず失敗する
	//   dead-form」+ 内部概念 (global master / ops) の英語露出になる (NN/G #1 visibility 違反)。
	//   UI hide (本フラグ) + server enforce (updateBenchmark action) の防御多層で、parent-admin は
	//   read-only 比較 (成長レポート RadarChart) のみを見る。判定基準は書込 guard の許可条件と一致:
	//   local identity (NUC 単一運用者) or cognito ops group member。
	const canEditBenchmark =
		locals.identity?.type === 'local' || isOpsMember(locals.identity ?? null);
	const [children, benchmarks, levelTitles] = await Promise.all([
		getAllChildren(tenantId),
		findAllBenchmarks(tenantId),
		getLevelTitleList(tenantId),
	]);

	const childrenWithStatus = await Promise.all(
		children.map(async (child) => {
			const [status, monthlyComparison, benchmarkValues] = await Promise.all([
				getChildStatus(child.id, tenantId),
				getMonthlyComparison(child.id, tenantId),
				getBenchmarkValues(child.age, tenantId),
			]);
			return {
				...child,
				status: 'error' in status ? null : status,
				monthlyComparison,
				benchmarkValues,
			};
		}),
	);

	// #2200: `?childId=N` クエリで指定された child を先頭に配置する。
	//   実画面で「`/admin/status?childId=903` を bookmark」した時の挙動と一致 (URL 不変式)。
	//   LP 撮影では `feature-monthly-report` SS で elementary fixture けんたくん (903・3,400P) を
	//   先頭に映してレーダー 5 軸を埋める用途 (ADR-0013 LP truth 整合)。
	//   不正な childId / 該当 child なしの場合は何もしない (デフォルト children[0])。
	const requestedChildIdRaw = url.searchParams.get('childId');
	const requestedChildId = requestedChildIdRaw ? asChildId(requestedChildIdRaw) : null;
	const sortedChildren =
		requestedChildId !== null
			? [
					...childrenWithStatus.filter((c) => c.id === requestedChildId),
					...childrenWithStatus.filter((c) => c.id !== requestedChildId),
				]
			: childrenWithStatus;

	return {
		children: sortedChildren,
		categoryDefs: CATEGORY_DEFS,
		benchmarks,
		levelTitles,
		canEditBenchmark,
	};
};

export const actions = {
	saveLevelTitle: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const level = Number(form.get('level'));
		const customTitle = String(form.get('customTitle') ?? '').trim();

		if (!level || level < 1 || level > 10) {
			return fail(400, { error: STATUS_LABELS.levelInvalid });
		}
		if (!customTitle || customTitle.length > 20) {
			return fail(400, { error: STATUS_LABELS.titleLengthInvalid });
		}

		await saveLevelTitle(tenantId, level, customTitle);
		return { success: true, levelTitleUpdated: true };
	},

	resetLevelTitle: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const level = Number(form.get('level'));

		if (!level || level < 1 || level > 10) {
			return fail(400, { error: STATUS_LABELS.levelInvalid });
		}

		await resetLevelTitle(tenantId, level);
		return { success: true, levelTitleReset: true };
	},

	resetAllLevelTitles: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		await resetAllLevelTitles(tenantId);
		return { success: true, levelTitlesAllReset: true };
	},

	updateBenchmark: async ({ request, locals }) => {
		// #3824 (CWE-639 隣接): market_benchmarks は全テナント共有のグローバル master のため、
		// 書込は ops/admin 相当 (ops group or NUC local) に限定する。parent-admin は 403。
		// tenantId 取得より前に評価し、認可判定を単一強制点 (ops-authz) に集約する (ADR-0063)。
		requireGlobalMasterWriteAccess(locals);
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const age = Number(form.get('age'));
		const categoryId = asCategoryId(formIdString(form.get('categoryId')));
		const mean = Number(form.get('mean'));
		const stdDev = Number(form.get('stdDev'));

		if (!age || !categoryId || Number.isNaN(mean) || Number.isNaN(stdDev)) {
			return fail(400, { error: ADMIN_FORM_ERROR_LABELS.requiredFieldsMissing });
		}
		if (mean < 0 || stdDev <= 0) {
			return fail(400, { error: STATUS_LABELS.benchmarkValueInvalid });
		}

		// #2057: 内部 source identifier (DB 保存値、UI 表示なし)。既存レコードとの履歴整合のため
		// 「管理画面」リテラルを保持。UI 表記は ADMIN_VIEW_TERMS.canonical で別途集約済。
		await upsertBenchmark(age, categoryId, mean, stdDev, '管理画面', tenantId);
		return { success: true, benchmarkUpdated: true };
	},
} satisfies Actions;
