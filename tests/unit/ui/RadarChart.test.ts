// tests/unit/ui/RadarChart.test.ts
// RadarChart の正規化ロジック・SVG座標計算テスト
//
// Svelte 5 コンポーネントのDOMレンダリングテストはjsdom非対応のため、
// 純粋なロジック（正規化・座標計算）をテストする。
// 目視確認は baby/kinder 画面で実施。

import { describe, it, expect } from 'vitest';

// --- 正規化ロジック ---
// RadarChart.svelte の $derived と同等のロジック
// 偏差値 [20, 70] → プロット [0%, 100%]（下限5%, 上限100%にクランプ）
function normalizeDeviationScore(ds: number): number {
	return Math.min(100, Math.max(5, ((ds - 20) / 50) * 100));
}

// --- SVG座標計算 ---
// RadarChart.svelte の getAngle / getPoint と同等
function getAngle(index: number): number {
	return (Math.PI * 2 * index) / 5 - Math.PI / 2;
}

function getPoint(
	index: number,
	pct: number,
	center: number,
	maxRadius: number,
): { x: number; y: number } {
	const angle = getAngle(index);
	const r = (pct / 100) * maxRadius;
	return {
		x: center + r * Math.cos(angle),
		y: center + r * Math.sin(angle),
	};
}

function polygonPoints(values: number[], center: number, maxRadius: number): string {
	return values
		.map((v, i) => {
			const p = getPoint(i, v, center, maxRadius);
			return `${p.x},${p.y}`;
		})
		.join(' ');
}

// 星評価テキスト生成
function starText(stars: number): string {
	return '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars));
}

// --- テスト ---

describe('偏差値→プロット正規化', () => {
	it('偏差値50 → 60%', () => {
		expect(normalizeDeviationScore(50)).toBe(60);
	});

	it('偏差値65 → 90%', () => {
		expect(normalizeDeviationScore(65)).toBe(90);
	});

	it('偏差値42 → 44%', () => {
		expect(normalizeDeviationScore(42)).toBe(44);
	});

	it('偏差値58 → 76%', () => {
		expect(normalizeDeviationScore(58)).toBe(76);
	});

	it('偏差値20 → 5%（下限クランプ: 式上は0だが最低5%）', () => {
		expect(normalizeDeviationScore(20)).toBe(5);
	});

	it('偏差値10（20未満）→ 5%（下限クランプ）', () => {
		expect(normalizeDeviationScore(10)).toBe(5);
	});

	it('偏差値0 → 5%（下限クランプ）', () => {
		expect(normalizeDeviationScore(0)).toBe(5);
	});

	it('偏差値70 → 100%（上限）', () => {
		expect(normalizeDeviationScore(70)).toBe(100);
	});

	it('偏差値80（70超）→ 100%（上限クランプ）', () => {
		expect(normalizeDeviationScore(80)).toBe(100);
	});

	it('偏差値30 → 20%', () => {
		expect(normalizeDeviationScore(30)).toBe(20);
	});

	it('星評価との整合: ★1(<42)は44%未満', () => {
		// ★1 = 偏差値41以下
		expect(normalizeDeviationScore(41)).toBeLessThan(44);
	});

	it('星評価との整合: ★2(42-49)は44-58%', () => {
		expect(normalizeDeviationScore(42)).toBeCloseTo(44);
		expect(normalizeDeviationScore(49)).toBeCloseTo(58);
	});

	it('星評価との整合: ★3(50-57)は60-74%', () => {
		expect(normalizeDeviationScore(50)).toBe(60);
		expect(normalizeDeviationScore(57)).toBe(74);
	});

	it('星評価との整合: ★4(58-64)は76-88%', () => {
		expect(normalizeDeviationScore(58)).toBe(76);
		expect(normalizeDeviationScore(64)).toBe(88);
	});

	it('星評価との整合: ★5(65+)は90%+', () => {
		expect(normalizeDeviationScore(65)).toBe(90);
		expect(normalizeDeviationScore(70)).toBe(100);
	});
});

describe('SVG座標計算', () => {
	const center = 150; // size=300 → center=150
	const maxRadius = 90; // size*0.30=90

	it('頂点0（上方向）のアングルは-π/2', () => {
		const angle = getAngle(0);
		expect(angle).toBeCloseTo(-Math.PI / 2);
	});

	it('頂点0, 100%はチャート上端に位置する', () => {
		const p = getPoint(0, 100, center, maxRadius);
		expect(p.x).toBeCloseTo(center); // 中心X
		expect(p.y).toBeCloseTo(center - maxRadius); // 上方向 = y減少
	});

	it('値0%のポイントは中心に位置する', () => {
		for (let i = 0; i < 5; i++) {
			const p = getPoint(i, 0, center, maxRadius);
			expect(p.x).toBeCloseTo(center);
			expect(p.y).toBeCloseTo(center);
		}
	});

	it('値100%のポイントは最大半径の位置にある', () => {
		const p = getPoint(0, 100, center, maxRadius);
		const distance = Math.sqrt((p.x - center) ** 2 + (p.y - center) ** 2);
		expect(distance).toBeCloseTo(maxRadius);
	});

	it('値50%のポイントは半分の半径に位置する', () => {
		const p = getPoint(0, 50, center, maxRadius);
		const distance = Math.sqrt((p.x - center) ** 2 + (p.y - center) ** 2);
		expect(distance).toBeCloseTo(maxRadius / 2);
	});

	it('5頂点は等間隔に配置される（72°ずつ）', () => {
		const angles = Array.from({ length: 5 }, (_, i) => getAngle(i));
		for (let i = 0; i < 5; i++) {
			const diff = angles[(i + 1) % 5]! - angles[i]!;
			// 72度 = 2π/5 ≈ 1.2566
			const expected = (2 * Math.PI) / 5;
			// ラップアラウンド対応
			const normalizedDiff = ((diff % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
			expect(normalizedDiff).toBeCloseTo(expected, 5);
		}
	});

	it('polygonPointsが正しいフォーマットで座標文字列を生成する', () => {
		const values = [60, 60, 60, 60, 60];
		const result = polygonPoints(values, center, maxRadius);
		const points = result.split(' ');
		expect(points.length).toBe(5);
		for (const point of points) {
			const [x, y] = point.split(',');
			expect(Number.isFinite(Number(x))).toBe(true);
			expect(Number.isFinite(Number(y))).toBe(true);
		}
	});

	it('全値0のpolygonPointsは全て中心座標になる', () => {
		const values = [0, 0, 0, 0, 0];
		const result = polygonPoints(values, center, maxRadius);
		const points = result.split(' ');
		for (const point of points) {
			const [x, y] = point.split(',');
			expect(Number(x)).toBeCloseTo(center);
			expect(Number(y)).toBeCloseTo(center);
		}
	});
});

describe('viewBox計算', () => {
	it('size=300 → padding=120, viewBox="-120 -120 540 540"', () => {
		const size = 300;
		const padding = size * 0.4;
		const viewBoxSize = size + padding * 2;
		expect(padding).toBe(120);
		expect(viewBoxSize).toBe(540);
	});

	it('size=240 → padding=96, viewBox="-96 -96 432 432"', () => {
		const size = 240;
		const padding = size * 0.4;
		const viewBoxSize = size + padding * 2;
		expect(padding).toBe(96);
		expect(viewBoxSize).toBe(432);
	});

	it('size=360 → padding=144, viewBox="-144 -144 648 648"', () => {
		const size = 360;
		const padding = size * 0.4;
		const viewBoxSize = size + padding * 2;
		expect(padding).toBe(144);
		expect(viewBoxSize).toBe(648);
	});
});

describe('星評価テキスト', () => {
	it('0★ → ☆☆☆', () => {
		expect(starText(0)).toBe('☆☆☆');
	});

	it('1★ → ★☆☆', () => {
		expect(starText(1)).toBe('★☆☆');
	});

	it('2★ → ★★☆', () => {
		expect(starText(2)).toBe('★★☆');
	});

	it('3★ → ★★★', () => {
		expect(starText(3)).toBe('★★★');
	});

	it('5★ → ★★★★★（3超の場合☆なし）', () => {
		expect(starText(5)).toBe('★★★★★');
	});
});
