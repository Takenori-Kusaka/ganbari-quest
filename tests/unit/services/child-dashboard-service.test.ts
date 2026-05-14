/**
 * ChildDashboardService — POC test suite (Issue #2069 / ADR-0046)
 *
 * カバー範囲:
 *   - ProductionDashboardService: コンストラクタで受け取った getter 関数で最新値取得
 *   - DemoDashboardService: SSR (sessionStorage 不在) で seed を返す / CSR で restore する /
 *     壊れた JSON で seed fallback する
 *   - persistDemoHomeData / clearDemoHomeData: storage 不在環境で例外を投げない
 *   - getter 経由なので seed 元 (例: layout の data) が変化したら自動追従
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import {
	clearDemoHomeData,
	createDemoDashboardService,
	DemoDashboardService,
	persistDemoHomeData,
} from '$lib/services/demo/DashboardService';
import {
	createProductionDashboardService,
	ProductionDashboardService,
} from '$lib/services/production/DashboardService';
import type { ChildDashboardHomeData } from '$lib/services/types';

const SAMPLE_SEED: ChildDashboardHomeData = {
	child: null,
	todayRecorded: [{ activityId: 1, count: 2 }],
	pointSettings: DEFAULT_POINT_SETTINGS,
};

describe('ProductionDashboardService', () => {
	it('kind は "production"', () => {
		const svc = createProductionDashboardService(() => SAMPLE_SEED);
		expect(svc.kind).toBe('production');
	});

	it('getHomeData は getter が返したスナップショットを返す', () => {
		const svc = new ProductionDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('factory 関数は ProductionDashboardService インスタンスを返す', () => {
		const svc = createProductionDashboardService(() => SAMPLE_SEED);
		expect(svc).toBeInstanceOf(ProductionDashboardService);
	});

	it('getter が変化した値を返したら getHomeData も追従する', () => {
		let current: ChildDashboardHomeData = SAMPLE_SEED;
		const svc = createProductionDashboardService(() => current);
		expect(svc.getHomeData().todayRecorded).toEqual(SAMPLE_SEED.todayRecorded);
		current = {
			child: null,
			todayRecorded: [{ activityId: 99, count: 3 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
		expect(svc.getHomeData().todayRecorded).toEqual([{ activityId: 99, count: 3 }]);
	});
});

describe('DemoDashboardService', () => {
	const DEMO_KEY = 'gq:demo:child-dashboard-home-v1';

	beforeEach(() => {
		// 各テストの前に sessionStorage をクリア（jsdom 環境）
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.clear();
		}
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('kind は "demo"', () => {
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.kind).toBe('demo');
	});

	it('factory 関数は DemoDashboardService インスタンスを返す', () => {
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc).toBeInstanceOf(DemoDashboardService);
	});

	it('CSR (sessionStorage 有 + 中身なし) で seed を返す', () => {
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('CSR で sessionStorage に valid なデータがあればそれを返す', () => {
		const stored: ChildDashboardHomeData = {
			child: null,
			todayRecorded: [{ activityId: 9, count: 5 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
		sessionStorage.setItem(DEMO_KEY, JSON.stringify(stored));
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData().todayRecorded).toEqual(stored.todayRecorded);
	});

	it('壊れた JSON があったら seed に fallback する', () => {
		sessionStorage.setItem(DEMO_KEY, '{not-valid-json');
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('schema 違反 (todayRecorded が配列でない) なら seed に fallback', () => {
		sessionStorage.setItem(DEMO_KEY, JSON.stringify({ todayRecorded: 'broken' }));
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('SSR (window 不在) では seed をそのまま返す', () => {
		// jsdom 環境では window が定義済みのため、明示的に undefined を stub する
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('sessionStorage', undefined);
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('persistDemoHomeData は SSR (window 不在) で例外を投げない', () => {
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('sessionStorage', undefined);
		expect(() => persistDemoHomeData(SAMPLE_SEED)).not.toThrow();
	});

	it('clearDemoHomeData は SSR (window 不在) で例外を投げない', () => {
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('sessionStorage', undefined);
		expect(() => clearDemoHomeData()).not.toThrow();
	});

	it('persistDemoHomeData → getHomeData の往復で同一データを取得できる', () => {
		const customSeed: ChildDashboardHomeData = {
			child: null,
			todayRecorded: [{ activityId: 42, count: 7 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
		persistDemoHomeData(customSeed);
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData().todayRecorded).toEqual(customSeed.todayRecorded);
	});

	it('clearDemoHomeData 後は seed が返る', () => {
		persistDemoHomeData({
			child: null,
			todayRecorded: [{ activityId: 1, count: 99 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		});
		clearDemoHomeData();
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('getter 経由なので layout の data 変化に追従する', () => {
		let current: ChildDashboardHomeData = SAMPLE_SEED;
		const svc = createDemoDashboardService(() => current);
		expect(svc.getHomeData().todayRecorded).toEqual(SAMPLE_SEED.todayRecorded);
		current = {
			child: null,
			todayRecorded: [{ activityId: 77, count: 11 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
		expect(svc.getHomeData().todayRecorded).toEqual([{ activityId: 77, count: 11 }]);
	});
});
