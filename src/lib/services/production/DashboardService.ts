/**
 * ProductionDashboardService — ADR-0046 (Issue #2069 + #2085)
 *
 * 本番 (Cognito 認証 + Drizzle ORM 経由) の ChildDashboardService 実装。
 *
 * Issue #2069 POC scope (PR #2079):
 *   - SvelteKit の SSR load 関数 (`+layout.server.ts` / `+page.server.ts`) が
 *     既存通り DB から組み立てたデータを **そのまま受け取り**、
 *     UI コンポーネントへの「窓口」として interface 形式で提示する。
 *   - DB アクセスや認証 (`requireTenantId`) は既存の +page.server.ts に残し、
 *     POC 段階では本 service は組み立て済みデータの保持に専念する
 *     (= 既存挙動を保証し、UI 等価性を担保する)。
 *
 * Issue #2085 拡張 scope:
 *   - write API (recordActivity / cancelRecord / claimLoginBonus /
 *     toggleActivityPin) を追加。
 *   - 本番側は既存 REST `/api/v1/...` エンドポイントを `fetch` で呼ぶ。
 *     これにより server-side services (activity-log-service / login-bonus-service /
 *     activity-pin-service) のロジックを二重実装せず DRY を保つ。
 *   - childId は constructor 時に getter で注入されるため、page navigation
 *     後も最新の child.id を fetch URL に組み込める。
 *
 * Reactive 設計:
 *   - SvelteKit の `data` (PageData) は navigation 時に再生成されるため、
 *     service は **「getter 関数」を保持し、呼び出しのたびに最新値を返す**
 *     形にしている。これにより Svelte 5 の `state_referenced_locally` 警告を
 *     回避し、layout 再描画時の data 変化に追従できる。
 */

import type {
	CancelRecordInput,
	CancelRecordResult,
	ChildDashboardHomeData,
	ChildDashboardService,
	ClaimLoginBonusResult,
	RecordActivityInput,
	RecordActivityWriteResult,
	ToggleActivityPinInput,
	ToggleActivityPinResult,
} from '../types';

/**
 * fetch ラッパ。`window.fetch` と SSR (load 関数の `fetch` 引数) どちらでも
 * 動くよう、constructor で `fetchFn` を注入できる。デフォルトは
 * `globalThis.fetch`。テスト時は mock を渡せる。
 */
export type FetchFn = typeof fetch;

export class ProductionDashboardService implements ChildDashboardService {
	readonly kind = 'production' as const;

	readonly #getHomeData: () => ChildDashboardHomeData;
	readonly #fetchFn: FetchFn;

	constructor(getHomeData: () => ChildDashboardHomeData, fetchFn: FetchFn = globalThis.fetch) {
		this.#getHomeData = getHomeData;
		// SSR では `globalThis.fetch` が undefined のケースがあるため、
		// undefined の場合は呼出時に最新の globalThis.fetch を取り直す
		this.#fetchFn = fetchFn;
	}

	getHomeData(): ChildDashboardHomeData {
		return this.#getHomeData();
	}

	/**
	 * `child.id` を取得 (write API 共通 prerequisite)。未選択時は null を返す。
	 */
	#getChildId(): number | null {
		const home = this.#getHomeData();
		return home.child?.id ?? null;
	}

	#fetch(): FetchFn {
		// 初期化時に globalThis.fetch が undefined だったケース (SSR の一部経路) で
		// 呼出時に取り直すフォールバック
		return this.#fetchFn ?? globalThis.fetch;
	}

	async recordActivity(input: RecordActivityInput): Promise<RecordActivityWriteResult> {
		const childId = this.#getChildId();
		if (childId === null) return { ok: false, error: 'NOT_FOUND' };

		try {
			const res = await this.#fetch()('/api/v1/activity-logs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ childId, activityId: input.activityId }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}) as { error?: string });
				if (body?.error === 'ALREADY_RECORDED') return { ok: false, error: 'ALREADY_RECORDED' };
				if (body?.error === 'NOT_FOUND') return { ok: false, error: 'NOT_FOUND' };
				return { ok: false, error: 'NETWORK' };
			}
			const data = (await res.json()) as {
				id: number;
				activityName: string;
				totalPoints: number;
				streakDays: number;
				streakBonus: number;
				cancelableUntil: string | null;
			};
			return {
				ok: true,
				logId: data.id,
				activityName: data.activityName,
				totalPoints: data.totalPoints,
				streakDays: data.streakDays,
				streakBonus: data.streakBonus,
				cancelableUntil: data.cancelableUntil,
			};
		} catch {
			return { ok: false, error: 'NETWORK' };
		}
	}

	async cancelRecord(input: CancelRecordInput): Promise<CancelRecordResult> {
		try {
			const res = await this.#fetch()(`/api/v1/activity-logs/${input.logId}`, {
				method: 'DELETE',
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}) as { error?: string });
				if (body?.error === 'CANCEL_EXPIRED') return { ok: false, error: 'CANCEL_EXPIRED' };
				if (body?.error === 'NOT_FOUND') return { ok: false, error: 'NOT_FOUND' };
				return { ok: false, error: 'NETWORK' };
			}
			const data = (await res.json()) as { refundedPoints: number };
			return { ok: true, refundedPoints: data.refundedPoints };
		} catch {
			return { ok: false, error: 'NETWORK' };
		}
	}

	async claimLoginBonus(): Promise<ClaimLoginBonusResult> {
		const childId = this.#getChildId();
		if (childId === null) return { ok: false, error: 'NOT_FOUND' };

		try {
			const res = await this.#fetch()(`/api/v1/login-bonus/${childId}/claim`, {
				method: 'POST',
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}) as { error?: string });
				if (body?.error === 'ALREADY_CLAIMED') return { ok: false, error: 'ALREADY_CLAIMED' };
				if (body?.error === 'NOT_FOUND') return { ok: false, error: 'NOT_FOUND' };
				return { ok: false, error: 'NETWORK' };
			}
			const data = (await res.json()) as {
				rank: string;
				basePoints: number;
				multiplier: number;
				totalPoints: number;
				consecutiveLoginDays: number;
			};
			return {
				ok: true,
				rank: data.rank,
				basePoints: data.basePoints,
				multiplier: data.multiplier,
				totalPoints: data.totalPoints,
				consecutiveLoginDays: data.consecutiveLoginDays,
			};
		} catch {
			return { ok: false, error: 'NETWORK' };
		}
	}

	async toggleActivityPin(input: ToggleActivityPinInput): Promise<ToggleActivityPinResult> {
		const childId = this.#getChildId();
		if (childId === null) return { ok: false, error: 'NOT_FOUND' };

		try {
			const res = await this.#fetch()(
				`/api/v1/children/${childId}/activities/${input.activityId}/pin`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ pinned: input.pinned }),
				},
			);
			if (!res.ok) {
				const body = await res.json().catch(() => ({}) as { error?: string });
				// activity-pin-service は LIMIT 超過時に Error throw → 'VALIDATION_ERROR' で返る
				// メッセージ中に「上限」が含まれていれば LIMIT_EXCEEDED にマッピング
				const msg = (body as { message?: string })?.message ?? '';
				if (msg.includes('上限')) return { ok: false, error: 'LIMIT_EXCEEDED' };
				if (body?.error === 'NOT_FOUND') return { ok: false, error: 'NOT_FOUND' };
				return { ok: false, error: 'NETWORK' };
			}
			const data = (await res.json()) as { isPinned: boolean };
			return { ok: true, isPinned: data.isPinned };
		} catch {
			return { ok: false, error: 'NETWORK' };
		}
	}
}

/**
 * Factory helper — `+layout.svelte` から
 * `setDashboardService(createProductionDashboardService(() => ({...data})))` の
 * 形で getter 関数を渡す。setContext は初期化時 1 回のみだが、getter は
 * 呼び出しのたびに最新の closure をたどるため reactive 値も追従できる。
 *
 * 第 2 引数 `fetchFn` はテスト時に mock を渡せる (省略時は `globalThis.fetch`)。
 */
export function createProductionDashboardService(
	getHomeData: () => ChildDashboardHomeData,
	fetchFn?: FetchFn,
): ProductionDashboardService {
	return new ProductionDashboardService(getHomeData, fetchFn);
}
