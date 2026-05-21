/**
 * Issue #2364: ChallengeSetPayloadSchema Valibot 単体テスト
 *
 * SSOT 整合: `src/lib/domain/marketplace-item.ts` `ChallengeSetPayload` interface (#2297)。
 * 形は monthDay / durationDays / categoryId (1-5) / baseTarget / rewardPoints / icon。
 * 参照データ: `src/lib/data/marketplace/challenge-sets/japan-annual-events.json` (15 件)。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { ChallengeSetPayloadSchema } from '$lib/marketplace/schemas/challenge-set-schema.js';

describe('ChallengeSetPayloadSchema', () => {
	test('ひな祭り型 challenge (monthDay 03-03 / categoryId=3 / durationDays=3) で success', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'ひな祭り大そうじ + 飾りつけ',
					description: 'ひな人形の飾りつけ・お部屋のお片付け・ちらし寿司のお手伝い。',
					monthDay: '03-03',
					durationDays: 3,
					categoryId: 3,
					baseTarget: 3,
					rewardPoints: 30,
					icon: '🎎',
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.challenges[0]?.monthDay).toBe('03-03');
			expect(result.output.challenges[0]?.categoryId).toBe(3);
		}
	});

	test('夏休み長期 challenge (durationDays=42 / categoryId=2 / baseTarget=10) で success', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: '夏休み読書記録チャレンジ',
					description: '夏休みの自由読書を家族でカウントアップ。',
					monthDay: '08-31',
					durationDays: 42,
					categoryId: 2,
					baseTarget: 10,
					rewardPoints: 100,
					icon: '📚',
				},
			],
		});
		expect(result.success).toBe(true);
	});

	test('未知 categoryId (6) で fail (1-5 のみ受理)', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					description: 'X',
					monthDay: '01-01',
					durationDays: 1,
					categoryId: 6 as 1, // runtime validation 検証: 6 は picklist 範囲外で fail 期待
					baseTarget: 1,
					rewardPoints: 0,
					icon: '⭐',
				},
			],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.');
			expect(path).toContain('categoryId');
		}
	});

	test('不正な monthDay 形式 (13-01) で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					description: 'X',
					monthDay: '13-01',
					durationDays: 1,
					categoryId: 1,
					baseTarget: 1,
					rewardPoints: 0,
					icon: '⭐',
				},
			],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.');
			expect(path).toContain('monthDay');
		}
	});

	test('不正な monthDay 形式 (2026-03-03 = YYYY-MM-DD ではない) で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					description: 'X',
					monthDay: '2026-03-03',
					durationDays: 1,
					categoryId: 1,
					baseTarget: 1,
					rewardPoints: 0,
					icon: '⭐',
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test('durationDays が 0 で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					description: 'X',
					monthDay: '01-01',
					durationDays: 0,
					categoryId: 1,
					baseTarget: 1,
					rewardPoints: 0,
					icon: '⭐',
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test('baseTarget が 0 で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					description: 'X',
					monthDay: '01-01',
					durationDays: 1,
					categoryId: 1,
					baseTarget: 0,
					rewardPoints: 0,
					icon: '⭐',
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test('description が空文字で fail (interface 上 description は必須)', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					description: '',
					monthDay: '01-01',
					durationDays: 1,
					categoryId: 1,
					baseTarget: 1,
					rewardPoints: 0,
					icon: '⭐',
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test('空 challenges 配列で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, { challenges: [] });
		expect(result.success).toBe(false);
	});

	test('実 fixture japan-annual-events.json (15 件) が schema を満たす (将来 divergence 検知)', () => {
		// recommend-1: 実配信中の JSON が schema に整合することを継続検証する。
		// schema と interface が再び divergence した場合、本 test が即 fail する。
		const fixturePath = resolve(
			process.cwd(),
			'src/lib/data/marketplace/challenge-sets/japan-annual-events.json',
		);
		const raw = readFileSync(fixturePath, 'utf-8');
		const parsed = JSON.parse(raw);
		const result = v.safeParse(ChallengeSetPayloadSchema, parsed.payload);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.challenges.length).toBe(15);
		}
	});
});
