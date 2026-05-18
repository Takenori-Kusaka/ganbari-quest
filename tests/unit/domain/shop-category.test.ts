// tests/unit/domain/shop-category.test.ts
// #2157: deriveShopCategory ヒューリスティック検証
//
// 3 系統 (physical / money / privilege) への振り分けが
// preset-rewards.ts の SSOT と整合することを確認する。

import { describe, expect, it } from 'vitest';
import { getAllPresetRewards } from '$lib/data/preset-rewards';
import { deriveShopCategory } from '$lib/domain/shop-category';

describe('deriveShopCategory', () => {
	describe('money (お小遣い系)', () => {
		it('「おこづかい」を含む title は money', () => {
			expect(deriveShopCategory({ title: 'おこづかい 100円', icon: '🪙' })).toBe('money');
			expect(deriveShopCategory({ title: 'おこづかい 500円', icon: '💴' })).toBe('money');
		});

		it('「貯金」「ちょきん」を含む title は money', () => {
			expect(deriveShopCategory({ title: 'りょこう ちょきん +1000円' })).toBe('money');
			expect(deriveShopCategory({ title: '貯金 500円分' })).toBe('money');
		});

		it('「○○円」表記を含む title は money', () => {
			expect(deriveShopCategory({ title: 'お買い物 300円' })).toBe('money');
		});

		it('money 系アイコンは money 判定', () => {
			expect(deriveShopCategory({ title: 'ボーナス', icon: '💰' })).toBe('money');
			expect(deriveShopCategory({ title: 'ごほうび', icon: '💵' })).toBe('money');
		});
	});

	describe('privilege (特権・体験系)', () => {
		it('「時間」を含む title は privilege', () => {
			expect(deriveShopCategory({ title: 'ゲーム時間 +30分', icon: '🎮' })).toBe('privilege');
			expect(deriveShopCategory({ title: 'YouTube時間 +30分', icon: '📺' })).toBe('privilege');
		});

		it('「○○けん」表記は privilege (けんかは除外)', () => {
			expect(deriveShopCategory({ title: 'よふかしけん', icon: '🌙' })).toBe('privilege');
			expect(deriveShopCategory({ title: 'あさねぼうけん', icon: '😴' })).toBe('privilege');
			// けんか は除外 (現物として扱う)
			expect(deriveShopCategory({ title: 'けんかしないグッズ' })).not.toBe('privilege');
		});

		it('「リクエスト」「メニュー」を含むものは privilege', () => {
			expect(deriveShopCategory({ title: 'すきなメニュー リクエスト', icon: '🍕' })).toBe(
				'privilege',
			);
		});

		it('「おでかけ」「えいが」「外食」は privilege', () => {
			expect(deriveShopCategory({ title: 'おでかけ', icon: '🚗' })).toBe('privilege');
			expect(deriveShopCategory({ title: 'えいが', icon: '🎬' })).toBe('privilege');
			expect(deriveShopCategory({ title: 'がいしょく', icon: '🍽️' })).toBe('privilege');
		});

		it('privilege 系アイコンは privilege 判定', () => {
			expect(deriveShopCategory({ title: 'スペシャル', icon: '🎟️' })).toBe('privilege');
		});
	});

	describe('physical (現物デフォルト)', () => {
		it('明示的に他系統でないものは physical', () => {
			expect(deriveShopCategory({ title: 'すきなシール', icon: '⭐' })).toBe('physical');
			expect(deriveShopCategory({ title: 'すきなおかし', icon: '🍬' })).toBe('physical');
			expect(deriveShopCategory({ title: 'すきな本', icon: '📚' })).toBe('physical');
			expect(deriveShopCategory({ title: 'すきなおもちゃ', icon: '🧸' })).toBe('physical');
		});

		it('description が空 or 未指定でも判定可能', () => {
			expect(deriveShopCategory({ title: 'ふでばこ' })).toBe('physical');
			expect(deriveShopCategory({ title: 'すきな文房具', icon: null })).toBe('physical');
		});
	});

	describe('preset SSOT との整合 (#1336)', () => {
		// preset-rewards.ts の shopCategory と deriveShopCategory の結果が
		// 80% 以上一致することを確認する (Pre-PMF Pragma: 完全一致は要求しない)
		it('preset の 80% 以上が一致する', () => {
			const presets = getAllPresetRewards();
			const matches = presets.filter(
				(p) =>
					deriveShopCategory({
						title: p.title,
						icon: p.icon,
					}) === p.shopCategory,
			);
			const matchRate = matches.length / presets.length;
			expect(matchRate).toBeGreaterThanOrEqual(0.8);
		});
	});
});
