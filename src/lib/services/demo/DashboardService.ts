/**
 * DemoDashboardService — ADR-0046 (Issue #2069 + #2085)
 *
 * 未認証 demo 画面用の ChildDashboardService 実装。
 *
 * Issue #2069 POC scope:
 *   - SSR 時はサーバ load (`/demo/(child)/[mode]/home/+page.server.ts`) が
 *     `getDemoHomeData()` (`$lib/server/demo/demo-service.ts`) でシード
 *     データを構築する。そのスナップショットを seed として保持。
 *   - クライアント (browser) ではタブ単位の `sessionStorage` から
 *     `record` 等の累積結果を復元できる構造を持つ。
 *
 * Issue #2085 拡張 scope:
 *   - write API (recordActivity / cancelRecord / claimLoginBonus /
 *     toggleActivityPin) を追加。
 *   - 各 write API は sessionStorage に書き戻し、ページ再 load 後も累積
 *     結果が維持される。
 *   - **server-side 経路は呼ばない** (Things Not To Do)。代わりに
 *     `$lib/server/demo/demo-service.ts` の `demoRecordActivity()` 等が
 *     返す固定値ロジックを **import せず参照値だけ揃える** (server-only
 *     module を client から import すると SvelteKit が build エラーを出す)。
 *
 * Reactive 設計:
 *   - SvelteKit の `data` (PageData) は navigation 時に再生成されるため、
 *     コンストラクタは **「seed getter」関数を受け取り**、呼び出しの度に
 *     最新の closure 値を読む。これにより Svelte 5 の
 *     `state_referenced_locally` 警告を避け、layout 再 mount なしで
 *     mode 切替 (preschool ↔ elementary 等) にも追従できる。
 *
 * 注意:
 *   - sessionStorage は SSR では undefined。必ず `typeof window` で
 *     ガードする。SSR で誤って参照すると "window is not defined" で
 *     hydration が壊れる (Issue #2069 Things Not To Do)。
 *   - write API は SSR (window 不在) 環境では in-memory のみで完了し、
 *     sessionStorage への persist は skip する (best-effort)。
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

/** タブ単位の demo state 隔離キー */
const DEMO_STORAGE_KEY = 'gq:demo:child-dashboard-home-v1';

/**
 * Demo 専用の固定戻り値定数。
 *
 * 本来は `$lib/server/demo/demo-service.ts` の `demoRecordActivity()` 等が
 * 同じ値を返すが、client から server-only module を import すると build
 * 失敗するため、ここで in-line に再定義する (DRY 違反だが境界が明確)。
 * 数値変更時は `demo-service.ts` 側と同期更新が必要。
 */
const DEMO_RECORD_TOTAL_POINTS_BASE = 15; // basePoints(10) + streakBonus(5) 相当
const DEMO_RECORD_STREAK_DAYS = 3;
const DEMO_RECORD_STREAK_BONUS = 2;
const DEMO_CANCEL_REFUNDED_POINTS = 10;
const DEMO_LOGIN_BONUS_BASE = 5;
const DEMO_LOGIN_BONUS_MULTIPLIER = 1.5;
const DEMO_LOGIN_BONUS_TOTAL = 8; // base * multiplier 近似値（demo-service.ts と同期）
const DEMO_LOGIN_BONUS_CONSECUTIVE = 3;
const DEMO_LOGIN_BONUS_RANK = 'kichi';

/**
 * sessionStorage の write 補助関数。
 * SSR / private mode 等で例外を投げない (best-effort persist)。
 */
function safeWriteStorage(data: ChildDashboardHomeData): void {
	if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
	} catch {
		// QuotaExceeded / private mode 等は黙って諦める
	}
}

export class DemoDashboardService implements ChildDashboardService, ToViewModelCapable {
	readonly kind = 'demo' as const;

	readonly #getSeed: () => ChildDashboardHomeData;

	/**
	 * In-memory pin state (demo 限定)。pin は server-side persist の代わりに
	 * 本サービスインスタンス内で保持する。ページ navigation で reset しても
	 * 良い (demo は best-effort)。
	 */
	#pinnedActivities = new Set<number>();

	/**
	 * 直近の record logId。`cancelRecord(input)` の `logId` は demo では
	 * 検証用途で受け取るのみで、実際は最後の record をキャンセル動作で
	 * decrement する (demo は activity_log 個別管理を持たない)。
	 */
	#lastRecordedActivityId: number | null = null;

	#loginBonusClaimedToday = false;

	constructor(getSeed: () => ChildDashboardHomeData) {
		this.#getSeed = getSeed;
	}

	getHomeData(): ChildDashboardHomeData {
		const seed = this.#getSeed();

		// SSR 環境: sessionStorage は未定義。seed をそのまま返す。
		if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
			return seed;
		}

		// CSR 環境: sessionStorage から restore を試みる。
		// 失敗 (JSON 壊れ / schema 変更等) しても silently seed に fallback する
		// — demo は user 価値が最優先で「動かなくなる」事故を最小化する。
		try {
			const raw = sessionStorage.getItem(DEMO_STORAGE_KEY);
			if (!raw) return seed;
			const restored = JSON.parse(raw) as ChildDashboardHomeData;
			// 最低限の sanity check — child / todayRecorded / pointSettings の存在のみ
			if (
				!restored ||
				typeof restored !== 'object' ||
				!Array.isArray((restored as { todayRecorded?: unknown }).todayRecorded) ||
				!(restored as { pointSettings?: unknown }).pointSettings
			) {
				return seed;
			}
			return restored;
		} catch {
			return seed;
		}
	}

	async recordActivity(input: RecordActivityInput): Promise<RecordActivityWriteResult> {
		// 現在の home data (seed もしくは restored) を取得
		const current = this.getHomeData();
		const recorded = [...current.todayRecorded];
		const idx = recorded.findIndex((r) => r.activityId === input.activityId);
		const existing = idx >= 0 ? recorded[idx] : undefined;
		if (existing) {
			recorded[idx] = { activityId: input.activityId, count: existing.count + 1 };
		} else {
			recorded.push({ activityId: input.activityId, count: 1 });
		}

		const next: ChildDashboardHomeData = {
			child: current.child,
			todayRecorded: recorded,
			pointSettings: current.pointSettings,
		};
		safeWriteStorage(next);
		this.#lastRecordedActivityId = input.activityId;

		// demo は activity 名前を持たないため、generic な戻り値を返す。
		// UI 側で `activityName` を補完したい場合は pageData から引く想定。
		return Promise.resolve({
			ok: true,
			logId: Date.now(), // demo 限定の合成 ID (cancelRecord 側は無視)
			activityName: 'デモ活動',
			totalPoints: DEMO_RECORD_TOTAL_POINTS_BASE,
			streakDays: DEMO_RECORD_STREAK_DAYS,
			streakBonus: DEMO_RECORD_STREAK_BONUS,
			cancelableUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
		});
	}

	async cancelRecord(_input: CancelRecordInput): Promise<CancelRecordResult> {
		const current = this.getHomeData();
		if (this.#lastRecordedActivityId === null) {
			return { ok: false, error: 'NOT_FOUND' };
		}
		const recorded = [...current.todayRecorded];
		const idx = recorded.findIndex((r) => r.activityId === this.#lastRecordedActivityId);
		const target = idx >= 0 ? recorded[idx] : undefined;
		if (!target || target.count <= 0) {
			return { ok: false, error: 'NOT_FOUND' };
		}
		// 1 件だけ減算 (count - 1)。0 になったらエントリ削除。
		const nextCount = target.count - 1;
		if (nextCount === 0) {
			recorded.splice(idx, 1);
		} else {
			recorded[idx] = { activityId: target.activityId, count: nextCount };
		}

		const next: ChildDashboardHomeData = {
			child: current.child,
			todayRecorded: recorded,
			pointSettings: current.pointSettings,
		};
		safeWriteStorage(next);
		this.#lastRecordedActivityId = null;

		return Promise.resolve({ ok: true, refundedPoints: DEMO_CANCEL_REFUNDED_POINTS });
	}

	async claimLoginBonus(): Promise<ClaimLoginBonusResult> {
		if (this.#loginBonusClaimedToday) {
			return { ok: false, error: 'ALREADY_CLAIMED' };
		}
		this.#loginBonusClaimedToday = true;
		return Promise.resolve({
			ok: true,
			rank: DEMO_LOGIN_BONUS_RANK,
			basePoints: DEMO_LOGIN_BONUS_BASE,
			multiplier: DEMO_LOGIN_BONUS_MULTIPLIER,
			totalPoints: DEMO_LOGIN_BONUS_TOTAL,
			consecutiveLoginDays: DEMO_LOGIN_BONUS_CONSECUTIVE,
		});
	}

	async toggleActivityPin(input: ToggleActivityPinInput): Promise<ToggleActivityPinResult> {
		if (input.pinned) {
			this.#pinnedActivities.add(input.activityId);
		} else {
			this.#pinnedActivities.delete(input.activityId);
		}
		return Promise.resolve({ ok: true, isPinned: input.pinned });
	}

	/**
	 * ADR-0047 Phase 3 (#2097): UI Contract `ChildHomeViewModel` を構築する。
	 *
	 * 設計原則:
	 *   - ProductionDashboardService.toViewModel() と同じ shape を生成 (型強制 SSOT)。
	 *   - `progressDisplay.type` 切替は **コンテキスト法則** に従う:
	 *       - baby / preschool / free プラン → `today-missions`
	 *       - elementary 以上 + standard 以上 → `category-level`
	 *     (demo / production の identity 固定 NG、深層調査 §5 案 B 失敗回避策)。
	 *   - `currency` は demo 固定 `{ symbol: 'P', code: 'POINTS' }` (PO Q4 = A)。
	 *   - `features.showShopTab` は demo でも `true` (PO Q5 = B 子供は買える、Phase 5 で
	 *     shop mock 商品買い flow 配線)。
	 *   - `activities` は marketplace pack 由来の 51+ 件 (PO Q6 = B、本番同等)。
	 *
	 * @param ctx demo `+page.server.ts` load 結果から抽出した補助 context
	 *            (activities / mustStatus / categoryXp 等は本 service 側で seed に
	 *            事前注入済みのため、ctx 経由でも参照可能)
	 * @returns DashboardView が直接受け取る UI Contract (本番と同じ shape)
	 */
	toViewModel(ctx: ToViewModelContext): ChildHomeViewModel {
		const home = this.getHomeData();
		const child = this.#buildChild(home, ctx);
		const currency = this.#buildCurrency();
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

	#buildChild(home: ChildDashboardHomeData, ctx: ToViewModelContext): ChildHomeChild {
		const c = home.child;
		if (!c) {
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
			pointBalance: 0, // demo は layout balance を直接表示するため ViewModel 経由しない
			level: 1, // overall level は廃止
			xpToNextLevel: 0,
			xpInLevel: 0,
			streakDays: 0,
			uiMode: ctx.uiMode,
		};
	}

	/** demo は通貨固定 P (PO Q4 = A) */
	#buildCurrency(): ChildHomeCurrency {
		return { symbol: 'P', code: 'POINTS' };
	}

	/**
	 * `progressDisplay` type union 判定 (ProductionDashboardService と同じ判定法則)。
	 *
	 * - baby / preschool / free プラン → `today-missions`
	 * - elementary 以上 + standard 以上 → `category-level`
	 *
	 * demo の planTier は基本的に `standard` (PO Q4 等) で渡されるが、
	 * ctx.planTier 経由で `free` が渡された場合も正しく対応する。
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
			streakBonus: 0,
			isPinned: this.#pinnedActivities.has(a.id) || !!a.isPinned,
			todayRecorded: recordedMap.get(a.id) ?? 0,
			isMust: !!a.isMission,
		}));
	}

	/**
	 * demo の 9 feature flag。本番と同じ shape を生成し、demo 固有の divergence は
	 * 個別 field 値で明示化する (隠蔽せず contract で表現)。
	 *
	 * PO Q5 = B: `showShopTab` は demo でも `true` (子供は買える、Phase 5 で mock 商品買い flow)。
	 * baby は ADR-0011 で gamification 抑制。
	 */
	#buildFeatures(ctx: ToViewModelContext): ChildHomeFeatureFlags {
		const isBaby = ctx.uiMode === 'baby';
		return {
			showShopTab: true,
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

	#buildAgeContext(ctx: ToViewModelContext): ChildHomeAgeContext {
		return {
			isBabyParentMode: ctx.uiMode === 'baby',
			ageTier: ctx.uiMode,
			planTier: ctx.planTier,
			isTrialActive: ctx.isTrialActive,
		};
	}
}

/**
 * Factory helper — `/demo/(child)/+layout.svelte` 等から
 * `setDashboardService(createDemoDashboardService(() => ({ ...data })))` の
 * 形で getter 関数を渡す。
 *
 * SSR 安全: seed は server load 由来の値で、browser でしか sessionStorage
 * 復元処理を行わない。
 */
export function createDemoDashboardService(
	getSeed: () => ChildDashboardHomeData,
): DemoDashboardService {
	return new DemoDashboardService(getSeed);
}

/** Demo state を sessionStorage に保存する (公開 helper、外部からも使えるよう export) */
export function persistDemoHomeData(data: ChildDashboardHomeData): void {
	safeWriteStorage(data);
}

/** Demo state を sessionStorage からクリアする (テスト / リセットボタン用) */
export function clearDemoHomeData(): void {
	if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.removeItem(DEMO_STORAGE_KEY);
	} catch {
		// ignore
	}
}
