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
	ChildHomeActivity,
	ChildHomeAgeContext,
	ChildHomeChild,
	ChildHomeCurrency,
	ChildHomeFeatureFlags,
	ChildHomeProgressDisplay,
	ChildHomeViewModel,
	ClaimLoginBonusResult,
	RecordActivityInput,
	RecordActivityWriteResult,
	ToggleActivityPinInput,
	ToggleActivityPinResult,
	ToViewModelCapable,
	ToViewModelContext,
} from '../types';

/**
 * fetch ラッパ。`window.fetch` と SSR (load 関数の `fetch` 引数) どちらでも
 * 動くよう、constructor で `fetchFn` を注入できる。デフォルトは
 * `globalThis.fetch`。テスト時は mock を渡せる。
 */
export type FetchFn = typeof fetch;

export class ProductionDashboardService implements ChildDashboardService, ToViewModelCapable {
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

	/**
	 * UI Contract `ChildHomeViewModel` を構築する (ADR-0047 Phase 2)。
	 *
	 * 設計原則:
	 *   - DashboardView (UI コンポーネント) は本メソッドの戻り値のみを受け取る。
	 *     Drizzle 生レコード型 (`as never` キャスト) は一切露出しない。
	 *   - `progressDisplay.type` は **コンテキスト法則** で切替わる:
	 *     `baby` / `preschool` / `free` プラン → `today-missions` (mustStatus / dailyMissions ベース)
	 *     `elementary` 以上 + `standard` 以上 → `category-level` (categoryXp ベース)
	 *     identity (demo / production の固定) で切替えない (ADR-0047 §決定 + 深層調査 §5 案 B 失敗回避)
	 *   - `features` は production の plan / age 状態から導出。demo (Phase 3) は別ロジックで同じ shape を返す。
	 *   - `currency` は production の `pointSettings.mode` を反映 (currency mode 時のみ ¥ + JPY)
	 *
	 * @param ctx `+page.server.ts` load 結果から抽出した補助 context (activities / mustStatus 等)
	 * @returns DashboardView が直接受け取る UI Contract
	 */
	toViewModel(ctx: ToViewModelContext): ChildHomeViewModel {
		const home = this.#getHomeData();
		const child = this.#buildChild(home, ctx);
		const currency = this.#buildCurrency(home);
		const progressDisplay = this.#buildProgressDisplay(ctx);
		const activities = this.#buildActivities(home, ctx);
		const features = this.#buildFeatures(ctx);
		const ageContext = this.#buildAgeContext(ctx);

		return {
			child,
			currency,
			progressDisplay,
			activities,
			features,
			uiMode: ctx.uiMode,
			ageContext,
		};
	}

	/**
	 * `ChildHomeChild` を構築。
	 *
	 * 注意: Drizzle の `Child` 型は `level` / `xpToNextLevel` / `xpInLevel` / `streakDays` を
	 * 持たない (これらは別 service / layout で計算される)。Phase 2 段階では、本 service が直接
	 * 把握しているのは `home.child` (Drizzle Child) のみのため、不足 field は 0 fallback とする
	 * (本番 page 側で overall level を直接 UI 表示する箇所がないため degrade 影響なし。
	 * カテゴリ別 level / XP は `progressDisplay.type === 'category-level'` 経路で表現される)。
	 */
	#buildChild(home: ChildDashboardHomeData, ctx: ToViewModelContext): ChildHomeChild {
		const c = home.child;
		if (!c) {
			// SSR 初期 / 子供未選択時の fallback (UI 層で child null 判定がないことを ViewModel で吸収)
			return {
				id: 0,
				nickname: '',
				pointBalance: 0,
				level: 1,
				xpToNextLevel: 0,
				xpInLevel: 0,
				streakDays: 0,
				uiMode: ctx.uiMode,
			};
		}
		return {
			id: c.id,
			nickname: c.nickname,
			pointBalance: 0, // layout 経由で balance を持つ。Phase 2 では ViewModel 直接表示なし
			level: 1, // overall level は廃止 (status-service §38-43 deprecated)
			xpToNextLevel: 0,
			xpInLevel: 0,
			streakDays: 0,
			uiMode: ctx.uiMode,
		};
	}

	/** `pointSettings.mode` を反映した currency contract */
	#buildCurrency(home: ChildDashboardHomeData): ChildHomeCurrency {
		const ps = home.pointSettings;
		if (ps.mode === 'currency') {
			// 通貨モードでは JPY のみを公式サポート (point-display.ts CURRENCY_DEFS)
			// 他通貨は表記 symbol だけ替わるが ViewModel code としては 'JPY' 一本化
			return { symbol: '¥', code: 'JPY' };
		}
		return { symbol: 'P', code: 'POINTS' };
	}

	/**
	 * `progressDisplay` type union 判定 (ADR-0047 核心ロジック)。
	 *
	 * コンテキスト法則:
	 *   - baby / preschool: `today-missions` (年齢が低いほどミッション中心 UX)
	 *   - free プラン: `today-missions` (free プランは categoryXp 表示なし)
	 *   - elementary 以上 + standard / family: `category-level`
	 */
	#buildProgressDisplay(ctx: ToViewModelContext): ChildHomeProgressDisplay {
		const useToday = ctx.uiMode === 'baby' || ctx.uiMode === 'preschool' || ctx.planTier === 'free';

		if (useToday) {
			return {
				type: 'today-missions',
				mustStatus: {
					completed: ctx.mustStatus?.logged ?? 0,
					total: ctx.mustStatus?.total ?? 0,
				},
				dailyMissions: {
					completed: ctx.dailyMissions?.completedCount ?? 0,
					total: ctx.dailyMissions?.missions.length ?? 0,
				},
			};
		}

		// category-level: categoryXp を 5 カテゴリ分マップ
		const categories: { id: number; name: string; level: number; xpPercent: number }[] = [];
		if (ctx.categoryXp) {
			for (const [idStr, info] of Object.entries(ctx.categoryXp)) {
				categories.push({
					id: Number(idStr),
					name: info.levelTitle,
					level: info.level,
					xpPercent: info.progressPct,
				});
			}
		}
		return { type: 'category-level', categories };
	}

	/** Activity grid 用 ViewModel field を構築 */
	#buildActivities(
		home: ChildDashboardHomeData,
		ctx: ToViewModelContext,
	): readonly ChildHomeActivity[] {
		const recordedMap = new Map(home.todayRecorded.map((r) => [r.activityId, r.count]));
		return ctx.activities.map((a) => ({
			id: a.id,
			name: a.name,
			icon: a.icon,
			categoryId: a.categoryId,
			categoryName: '', // category 名は UI 層 (CategorySection) が CATEGORY_DEFS から解決
			pointReward: a.basePoints ?? 0,
			streakBonus: 0, // record 結果から導出 (UI 側 result dialog で扱う)
			isPinned: !!a.isPinned,
			todayRecorded: recordedMap.get(a.id) ?? 0,
			isMust: !!a.isMission,
		}));
	}

	/**
	 * 9 feature flag を production の plan / age 状態から導出。
	 *
	 * - `showShopTab`: production では always true (有料プラン / 無料プラン両方で shop タブ表示)
	 * - `showXpAnimation` / `showMissionBadge` / `showPinButton` 等: baby は ADR-0011 で抑制
	 * - `showSiblingRanking`: family プランのみ (production の plan-limit-service と一致)
	 * - `showBirthdayBonus` / `showMonthlyReward` / `showStampCard` / `showEventBadge`:
	 *   premium 限定 or season-event 在否で表示判定 (本 Phase では feature flag のみ。UI 配線は page 側)
	 */
	#buildFeatures(ctx: ToViewModelContext): ChildHomeFeatureFlags {
		const isBaby = ctx.uiMode === 'baby';
		return {
			showShopTab: true, // production: shop タブは常時表示 (free / standard / family 共通)
			showXpAnimation: !isBaby,
			showMissionBadge: !isBaby,
			showPinButton: !isBaby,
			showEventBadge: !isBaby && ctx.activeEventBadge !== null,
			showSiblingRanking: !isBaby && ctx.planTier === 'family',
			showBirthdayBonus: !isBaby,
			showMonthlyReward: !isBaby && ctx.isPremium,
			showStampCard: !isBaby,
		};
	}

	/**
	 * 年齢 / プラン状態コンテキストを構築 (UI 層が age tier を再判定しないように)。
	 *
	 * `isBabyParentMode`: baby は ADR-0011 で「親の準備モード」として扱う。
	 * 本番 page 側で `data.uiMode === 'baby'` を判定して `BabyHomePage` に分岐済みのため、
	 * 本 field は ViewModel 経由で同じ判定を提供するインフラ (Phase 3 demo 側でも同じ法則を適用)。
	 */
	#buildAgeContext(ctx: ToViewModelContext): ChildHomeAgeContext {
		return {
			isBabyParentMode: ctx.uiMode === 'baby',
			ageTier: ctx.uiMode,
			planTier: ctx.planTier,
			isTrialActive: ctx.isTrialActive,
		};
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
