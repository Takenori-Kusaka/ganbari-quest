/**
 * tests/unit/scripts/check-stalled-bot-pr.test.ts (#4557)
 *
 * scripts/check-stalled-bot-pr.mjs の純粋関数を unit test する。
 *
 * 背景: `main-pr-base-guard` は dependabot/renovate の main 直行 PR を fail-close するが、
 * bot は失敗した PR を自動で retarget しないため人が気づくまで滞留する (#4532 実例)。
 * 本テストは「滞留の判定ロジックが壊れていることを検出できる」ことを保証する
 * (= 変異試験の恒久版として、境界条件・除外条件を固定する)。
 */

import { describe, expect, it } from 'vitest';

import {
	ageDays,
	buildCommentBody,
	buildDiscordPayload,
	filterStaleBotMainPrs,
	hasExistingMarkerComment,
	isBotAuthor,
	isGuardFailing,
} from '../../../scripts/check-stalled-bot-pr.mjs';

describe('isBotAuthor', () => {
	it('is_bot: true の author を bot と判定する (dependabot 実例)', () => {
		expect(isBotAuthor({ author: { login: 'app/dependabot', is_bot: true } })).toBe(true);
	});

	it('[bot] サフィックスの login を bot と判定する (is_bot 欠落フォールバック)', () => {
		expect(isBotAuthor({ author: { login: 'dependabot[bot]' } })).toBe(true);
	});

	it('app/ prefix の login を bot と判定する (is_bot 欠落フォールバック)', () => {
		expect(isBotAuthor({ author: { login: 'app/ganbari-quest-integrator' } })).toBe(true);
	});

	it('人間 author は bot と判定しない', () => {
		expect(isBotAuthor({ author: { login: 'Takenori-Kusaka', is_bot: false } })).toBe(false);
	});

	it('author が null なら bot と判定しない (クラッシュしない)', () => {
		expect(isBotAuthor({ author: null })).toBe(false);
	});
});

describe('ageDays', () => {
	it('経過日数を計算する', () => {
		expect(ageDays('2026-08-10T00:00:00Z', '2026-08-13T00:00:00Z')).toBe(3);
	});

	it('端数日も計算する (24h 未満は 1 日未満)', () => {
		expect(ageDays('2026-08-12T20:24:06Z', '2026-08-13T20:24:06Z')).toBe(1);
	});
});

describe('filterStaleBotMainPrs (#4532 実例に基づく回帰防止)', () => {
	const nowIso = '2026-08-15T00:00:00Z';

	it('base=main + bot + STALL_DAYS 以上経過した PR を候補として抽出する', () => {
		const prs = [
			{
				number: 4532,
				title: 'dependabot bump',
				author: { login: 'app/dependabot', is_bot: true },
				createdAt: '2026-08-12T20:24:06Z',
				url: 'https://example.com/4532',
				baseRefName: 'main',
			},
		];
		const result = filterStaleBotMainPrs(prs, { stallDays: 2, nowIso });
		expect(result).toHaveLength(1);
		expect(result[0]?.number).toBe(4532);
	});

	it('base=develop の PR は候補から除外する (通常レーンの PR を誤検知しない)', () => {
		const prs = [
			{
				number: 1,
				title: 'normal feature',
				author: { login: 'app/dependabot', is_bot: true },
				createdAt: '2026-08-01T00:00:00Z',
				url: 'https://example.com/1',
				baseRefName: 'develop',
			},
		];
		expect(filterStaleBotMainPrs(prs, { stallDays: 2, nowIso })).toEqual([]);
	});

	it('人間作成の main PR は候補から除外する (release PR 手動対応等)', () => {
		const prs = [
			{
				number: 2,
				title: 'human main pr',
				author: { login: 'Takenori-Kusaka', is_bot: false },
				createdAt: '2026-08-01T00:00:00Z',
				url: 'https://example.com/2',
				baseRefName: 'main',
			},
		];
		expect(filterStaleBotMainPrs(prs, { stallDays: 2, nowIso })).toEqual([]);
	});

	it('STALL_DAYS 未満の新規 PR は候補から除外する (即時 flag によるノイズ防止)', () => {
		const prs = [
			{
				number: 3,
				title: 'just opened',
				author: { login: 'app/dependabot', is_bot: true },
				createdAt: '2026-08-14T12:00:00Z', // now から 12h
				url: 'https://example.com/3',
				baseRefName: 'main',
			},
		];
		expect(filterStaleBotMainPrs(prs, { stallDays: 2, nowIso })).toEqual([]);
	});

	it(
		'統合 PR (release パターン、head=develop/release/* が正規に main へ向く) は' +
			'author が bot でも base=main が正規状態なので候補には残るが、' +
			'guard 自体は pass するため isGuardFailing 側で最終的に除外される',
		() => {
			// filterStaleBotMainPrs は guard 状態を見ないため、
			// 統合 PR (app/ganbari-quest-integrator, base=main が正規) も候補には入る。
			// 誤検知防止は isGuardFailing の責務であることを明示するテスト。
			const prs = [
				{
					number: 4534,
					title: '[統合] develop → main',
					author: { login: 'app/ganbari-quest-integrator', is_bot: true },
					createdAt: '2026-08-01T00:00:00Z',
					url: 'https://example.com/4534',
					baseRefName: 'main',
				},
			];
			expect(filterStaleBotMainPrs(prs, { stallDays: 2, nowIso })).toHaveLength(1);
		},
	);
});

describe('isGuardFailing (#4532 実例)', () => {
	it('main-pr-base-guard が bucket=fail なら滞留と判定する', () => {
		expect(isGuardFailing([{ name: 'main-pr-base-guard', bucket: 'fail' }])).toBe(true);
	});

	it('main-pr-base-guard が state=FAILURE でも滞留と判定する (bucket 欠落フォールバック)', () => {
		expect(isGuardFailing([{ name: 'main-pr-base-guard', state: 'FAILURE' }])).toBe(true);
	});

	it('main-pr-base-guard が pass (統合 PR の正規状態) なら滞留と判定しない', () => {
		expect(isGuardFailing([{ name: 'main-pr-base-guard', bucket: 'pass' }])).toBe(false);
	});

	it('main-pr-base-guard が skipping なら滞留と判定しない (cutover 前 grandfather 等)', () => {
		expect(isGuardFailing([{ name: 'main-pr-base-guard', bucket: 'skipping' }])).toBe(false);
	});

	it('checks 配列に main-pr-base-guard が無ければ滞留と判定しない (未実行を fail 扱いしない)', () => {
		expect(isGuardFailing([{ name: 'lint-and-test', bucket: 'pass' }])).toBe(false);
	});

	it('checks 0 件でもクラッシュしない', () => {
		expect(isGuardFailing([])).toBe(false);
	});
});

describe('hasExistingMarkerComment (再通知スパム防止)', () => {
	const marker = '<!-- stalled-bot-pr-check -->';

	it('マーカー付きコメントが既にあれば true (一度通知したら repeat しない)', () => {
		expect(hasExistingMarkerComment(['よろしく', `${marker}\n本文`], marker)).toBe(true);
	});

	it('マーカーが無ければ false', () => {
		expect(hasExistingMarkerComment(['よろしく', '別のコメント'], marker)).toBe(false);
	});

	it('{ comments } 形式でも読める', () => {
		expect(hasExistingMarkerComment({ comments: [`${marker}\n本文`] }, marker)).toBe(true);
	});

	it('空配列でも false (初回通知は必ず飛ぶ)', () => {
		expect(hasExistingMarkerComment([], marker)).toBe(false);
	});
});

describe('buildCommentBody / buildDiscordPayload (出力内容の健全性)', () => {
	const pr = {
		number: 4532,
		title: 'build(deps): Bump @hono/node-server',
		author: { login: 'app/dependabot', is_bot: true },
		createdAt: '2026-08-12T20:24:06Z',
		url: 'https://github.com/Takenori-Kusaka/ganbari-quest/pull/4532',
		baseRefName: 'main',
	};

	it('コメント本文にマーカー・PR 番号・retarget コマンドを含む', () => {
		const body = buildCommentBody(pr, 3);
		expect(body).toContain('<!-- stalled-bot-pr-check -->');
		expect(body).toContain('gh pr edit 4532 --base develop');
		expect(body).toContain('3 日以上 open');
	});

	it('Discord payload は valid JSON で embeds を含む', () => {
		const payload = buildDiscordPayload([pr]);
		const parsed = JSON.parse(payload);
		expect(parsed.embeds).toHaveLength(1);
		expect(parsed.embeds[0].title).toContain('1 件');
		expect(parsed.embeds[0].description).toContain('#4532');
	});
});
