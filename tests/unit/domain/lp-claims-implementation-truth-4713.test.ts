// tests/unit/domain/lp-claims-implementation-truth-4713.test.ts (#4713)
//
// LP / FAQ / 料金比較表の 5 つの訴求が「実装の事実」から導かれていることを機械検証する
// (ADR-0013 LP truth)。#4713 で観測された乖離は、いずれも **表示側に数値・挙動・画面名を
// 手書きした結果、実装を変えても表示が追随しなかった** ものであり、以下の pin が無ければ
// 同じ class が再発する。
//
//   1. 使いすぎ防止タイマー — 実装は「連続利用 15 分」なのに LP は「無操作 15 分」と逆
//   2. プリセット活動数 — 延べ 325 件を根拠に「300+ 種類」と訴求 (ユニークは 129 種)
//   3. ステータス軸名 — UI に存在しない「やる気・体力」を例示
//   4. 料金比較表の行名 — アプリに無い画面名「日次サマリー」
//   5. FAQ の招待説明 — 存在しない「閲覧権限」ロール

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../../src/lib/domain/categories';
import {
	AUTO_SLEEP_ACTIVE_MINUTES,
	AUTO_SLEEP_INACTIVE_RESET_MINUTES,
} from '../../../src/lib/domain/constants/auto-sleep';
import {
	LP_FAQ_LABELS,
	LP_FAQ_PHASEB_LABELS,
	LP_HERO_SPEC_BADGES_LABELS,
	LP_INDEX_PHASEB_LABELS,
	LP_PRICING_PHASEB_LABELS,
	USAGE_TIME_LABELS,
} from '../../../src/lib/domain/labels';
import {
	AUTO_SLEEP_TERMS,
	PRESET_ACTIVITY_TERMS,
	STATUS_AXIS_TERMS,
	USAGE_SUMMARY_TERMS,
} from '../../../src/lib/domain/terms';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ACTIVITY_PACKS_DIR = join(REPO_ROOT, 'src/lib/data/marketplace/activity-packs');

/** activity-packs の実データから「延べ件数 / 名前のユニーク数 / パック数」を数える。 */
function countActivityPacks(): { total: number; unique: number; packs: number } {
	const files = readdirSync(ACTIVITY_PACKS_DIR).filter((f) => f.endsWith('.json'));
	const names = new Set<string>();
	let total = 0;
	for (const f of files) {
		const data = JSON.parse(readFileSync(join(ACTIVITY_PACKS_DIR, f), 'utf8'));
		const activities: unknown[] = Array.isArray(data?.payload?.activities)
			? data.payload.activities
			: [];
		total += activities.length;
		for (const a of activities) {
			const name = (a as { name?: unknown })?.name;
			if (typeof name === 'string' && name !== '') names.add(name);
		}
	}
	return { total, unique: names.size, packs: files.length };
}

describe('#4713 使いすぎ防止タイマー (auto-sleep) の説明', () => {
	it('atom の分数が constants/auto-sleep.ts と一致する', () => {
		expect(AUTO_SLEEP_TERMS.activeDuration).toBe(`${AUTO_SLEEP_ACTIVE_MINUTES} 分`);
		expect(AUTO_SLEEP_TERMS.inactiveReset).toBe(`${AUTO_SLEEP_INACTIVE_RESET_MINUTES} 分`);
	});

	it('LP / FAQ が「連続利用で戻る」挙動を述べており、逆の「無操作で閉じる」を述べていない', () => {
		for (const text of [LP_FAQ_LABELS.text104, LP_FAQ_PHASEB_LABELS.k104]) {
			expect(text).toContain(`${AUTO_SLEEP_ACTIVE_MINUTES} 分つづけて使う`);
			expect(text).toContain(AUTO_SLEEP_TERMS.returnScreen);
			// 旧文言「15 分の無操作で画面が自動で閉じる」の再発防止 (挙動が逆)
			expect(text).not.toMatch(/無操作で画面が自動で閉じる/);
		}
	});
});

describe('#4713 プリセット活動数の訴求', () => {
	it('LP のユニーク種類訴求が実データのユニーク活動名を超えない', () => {
		const { unique } = countActivityPacks();
		const claimedBadge = Number.parseInt(PRESET_ACTIVITY_TERMS.uniqueCountBadge, 10);
		const claimedJa = Number.parseInt(PRESET_ACTIVITY_TERMS.uniqueCount, 10);
		expect(Number.isFinite(claimedBadge)).toBe(true);
		expect(Number.isFinite(claimedJa)).toBe(true);
		expect(claimedBadge).toBeLessThanOrEqual(unique);
		expect(claimedJa).toBeLessThanOrEqual(unique);
	});

	it('LP のセット数訴求が実 activity-pack 数を超えない', () => {
		const { packs } = countActivityPacks();
		const claimedPacks = Number.parseInt(PRESET_ACTIVITY_TERMS.packCount, 10);
		expect(Number.isFinite(claimedPacks)).toBe(true);
		expect(claimedPacks).toBeLessThanOrEqual(packs);
	});

	it('hero バッジ / 幼児パネルが atom 経由で組まれている (数値の直書きが無い)', () => {
		expect(LP_HERO_SPEC_BADGES_LABELS.presetCount).toBe(PRESET_ACTIVITY_TERMS.uniqueCountBadge);
		expect(LP_INDEX_PHASEB_LABELS.kinderCheck3).toContain(PRESET_ACTIVITY_TERMS.uniqueCountBadge);
	});

	it('延べ件数を訴求根拠にしない (延べ > ユニーク であることの明示的な記録)', () => {
		const { total, unique } = countActivityPacks();
		// 男の子 / 女の子 variant が同名活動を重複して持つため、延べは必ずユニークを上回る。
		// この関係が崩れた (= variant 重複が解消された) なら訴求値の見直し判断が要る。
		expect(total).toBeGreaterThan(unique);
	});
});

describe('#4713 ステータス軸名の訴求', () => {
	it('例示される軸名がすべて実カテゴリ名である', () => {
		const realNames = Object.values(CATEGORIES).map((c) => c.name);
		for (const axis of STATUS_AXIS_TERMS.examplePair.split('・')) {
			expect(realNames).toContain(axis);
		}
	});

	it('軸の総数訴求が実カテゴリ数と一致する', () => {
		expect(STATUS_AXIS_TERMS.axisCount).toBe(`${Object.keys(CATEGORIES).length} つの軸`);
	});

	it('LP 本文に UI に存在しない軸名 (やる気 / 体力) が出てこない', () => {
		expect(LP_INDEX_PHASEB_LABELS.softFamilySupportDesc).toContain(STATUS_AXIS_TERMS.examplePair);
		expect(LP_INDEX_PHASEB_LABELS.softFamilySupportDesc).not.toMatch(/やる気・体力/);
	});
});

describe('#4713 料金比較表の行名', () => {
	it('使用時間の行名がアプリの実見出しと同じ atom から引かれている', () => {
		expect(USAGE_TIME_LABELS.todayUsage).toBe(USAGE_SUMMARY_TERMS.today);
		expect(USAGE_TIME_LABELS.weeklyUsage).toBe(USAGE_SUMMARY_TERMS.weekly);
		expect(LP_PRICING_PHASEB_LABELS.k42).toContain(USAGE_SUMMARY_TERMS.today);
		expect(LP_PRICING_PHASEB_LABELS.k42).toContain(USAGE_SUMMARY_TERMS.weekly);
		// アプリに対応画面が無かった旧行名の再発防止
		expect(LP_PRICING_PHASEB_LABELS.k42).not.toMatch(/日次サマリー/);
	});

	it('チェックリストの行が 1 行で、取込ぶんも同じ枠を消費することを述べている', () => {
		expect(LP_PRICING_PHASEB_LABELS.k36).toContain('取込を含む');
		expect(LP_PRICING_PHASEB_LABELS.k36).toContain('3個/子まで');
		// 旧 k38 (「自由作成」を別枠のように見せる行) を復活させない
		expect(LP_PRICING_PHASEB_LABELS).not.toHaveProperty('k38');
	});
});

describe('#4713 FAQ の招待説明', () => {
	it('存在しない「閲覧権限」ロールを述べず、閲覧のみの共有を閲覧リンクに誘導する', () => {
		for (const text of [LP_FAQ_LABELS.text109, LP_FAQ_PHASEB_LABELS.k108]) {
			expect(text).not.toMatch(/閲覧権限/);
			expect(text).toContain('閲覧リンク');
		}
	});
});
