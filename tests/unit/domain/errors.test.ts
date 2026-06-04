// tests/unit/domain/errors.test.ts
// #744: PlanLimitError 共有型の単体テスト
// #787: getErrorMessage ヘルパーの追加

import { describe, expect, it } from 'vitest';
import {
	createPlanLimitError,
	getErrorMessage,
	isPlanLimitError,
	type PlanLimitError,
} from '../../../src/lib/domain/errors';

describe('#744 PlanLimitError', () => {
	describe('createPlanLimitError', () => {
		it('free → standard のアップセルエラーを構築する', () => {
			const err = createPlanLimitError(
				'free',
				'standard',
				'AI 活動提案はスタンダードプラン以上でご利用いただけます',
			);
			expect(err).toEqual({
				code: 'PLAN_LIMIT_EXCEEDED',
				message: 'AI 活動提案はスタンダードプラン以上でご利用いただけます',
				currentTier: 'free',
				requiredTier: 'standard',
				upgradeUrl: '/admin/subscription',
			});
		});

		it('standard → family のアップセルエラーを構築する', () => {
			const err = createPlanLimitError(
				'standard',
				'family',
				'きょうだいランキングはファミリープラン限定です',
			);
			expect(err.currentTier).toBe('standard');
			expect(err.requiredTier).toBe('family');
			expect(err.upgradeUrl).toBe('/admin/subscription');
		});

		it('upgradeUrl は常に /admin/subscription で固定', () => {
			const err = createPlanLimitError('free', 'family', 'msg');
			expect(err.upgradeUrl).toBe('/admin/subscription');
		});
	});

	describe('isPlanLimitError', () => {
		it('正しい形式を true 判定する', () => {
			const err: PlanLimitError = {
				code: 'PLAN_LIMIT_EXCEEDED',
				message: 'test',
				currentTier: 'free',
				requiredTier: 'standard',
				upgradeUrl: '/admin/subscription',
			};
			expect(isPlanLimitError(err)).toBe(true);
		});

		it('code が違えば false', () => {
			expect(
				isPlanLimitError({
					code: 'VALIDATION_ERROR',
					message: 'test',
					currentTier: 'free',
					requiredTier: 'standard',
					upgradeUrl: '/admin/subscription',
				}),
			).toBe(false);
		});

		it('currentTier が不正値なら false', () => {
			expect(
				isPlanLimitError({
					code: 'PLAN_LIMIT_EXCEEDED',
					message: 'test',
					currentTier: 'premium',
					requiredTier: 'standard',
					upgradeUrl: '/admin/subscription',
				}),
			).toBe(false);
		});

		it('requiredTier が free なら false（free へのアップセルはあり得ない）', () => {
			expect(
				isPlanLimitError({
					code: 'PLAN_LIMIT_EXCEEDED',
					message: 'test',
					currentTier: 'free',
					requiredTier: 'free',
					upgradeUrl: '/admin/subscription',
				}),
			).toBe(false);
		});

		it('upgradeUrl が違う path なら false', () => {
			expect(
				isPlanLimitError({
					code: 'PLAN_LIMIT_EXCEEDED',
					message: 'test',
					currentTier: 'free',
					requiredTier: 'standard',
					upgradeUrl: '/pricing',
				}),
			).toBe(false);
		});

		it('null / undefined / プリミティブは false', () => {
			expect(isPlanLimitError(null)).toBe(false);
			expect(isPlanLimitError(undefined)).toBe(false);
			expect(isPlanLimitError('PLAN_LIMIT_EXCEEDED')).toBe(false);
			expect(isPlanLimitError(403)).toBe(false);
		});
	});
});

describe('#787 getErrorMessage', () => {
	it('string をそのまま返す', () => {
		expect(getErrorMessage('エラーメッセージ')).toBe('エラーメッセージ');
	});

	it('空文字はそのまま空文字', () => {
		expect(getErrorMessage('')).toBe('');
	});

	it('PlanLimitError から message を抽出する', () => {
		const err = createPlanLimitError(
			'free',
			'standard',
			'スタンダードプラン以上でご利用いただけます',
		);
		expect(getErrorMessage(err)).toBe('スタンダードプラン以上でご利用いただけます');
	});

	it('null は空文字', () => {
		expect(getErrorMessage(null)).toBe('');
	});

	it('undefined は空文字', () => {
		expect(getErrorMessage(undefined)).toBe('');
	});

	it('message プロパティを持つ任意オブジェクトから文字列を抽出', () => {
		expect(getErrorMessage({ message: 'バリデーションエラー' })).toBe('バリデーションエラー');
	});

	it('message プロパティが文字列でない場合は空文字', () => {
		expect(getErrorMessage({ message: 123 })).toBe('');
		expect(getErrorMessage({ message: null })).toBe('');
	});

	it('message プロパティを持たないオブジェクトは空文字', () => {
		expect(getErrorMessage({})).toBe('');
		expect(getErrorMessage({ code: 'X' })).toBe('');
	});

	it('プリミティブ（数値 / boolean）は空文字', () => {
		expect(getErrorMessage(403)).toBe('');
		expect(getErrorMessage(true)).toBe('');
	});

	// #2894 AC3 回帰: admin/rewards の handleChildSelectionConfirm / handleCopyFromChild が
	// form action failure の data.error を `String(error)` していたため、reward 系 action の
	// plan gate 403 (PlanLimitError オブジェクト) が「[object Object]」と表示され、
	// plan-limit メッセージも件数表示も壊れていた (Issue #2894 証拠④)。
	// 修正後は getErrorMessage 経由で PlanLimitError.message を正しく取り出す。
	it('#2894: PlanLimitError を String() すると壊れるが getErrorMessage は message を返す', () => {
		const planLimitError = createPlanLimitError(
			'free',
			'standard',
			'ごほうび管理はスタンダードプラン以上でご利用いただけます',
		);
		// 旧バグ経路 (String) は壊れた表示になる — この回帰を二度と踏まないことを明示
		expect(String(planLimitError)).toBe('[object Object]');
		// 修正経路 (getErrorMessage) は人間可読な plan-limit メッセージを返す
		expect(getErrorMessage(planLimitError)).toBe(
			'ごほうび管理はスタンダードプラン以上でご利用いただけます',
		);
	});
});
