/**
 * scripts/__tests__/generate-lp-labels-drop-gate.test.mjs
 *
 * #4626: generate-lp-labels.mjs が「値を解決できなかった key」を無言で捨てないことの検証。
 *
 * 捨てられた key は site/shared-labels.js から丸ごと消えるため、
 * `sync-lp-fallback --check` は照合対象を失って「同期済み」と答えてしまう。
 * その状態では labels.ts を直しても LP は HTML 直書きの古い文言を出し続け、CI では気づけない。
 *
 * 実行: node --test scripts/__tests__/generate-lp-labels-drop-gate.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import {
	assertNoSilentDrops,
	extractDeclaredEntryNames,
	findSilentDrops,
	parseAllNamespacesResolved,
} from '../generate-lp-labels.mjs';

/** parseBlock が値を解決できない書き方だけを集めた fixture */
const DROPPED_FIXTURE = [
	'export const LP_DROP_LABELS = {',
	"\tok: 'これは載る',",
	"\tviaFn: formatSomething('引数'),",
	"\t'quoted-key': '引用符付き key',",
	'\t[COMPUTED_KEY]: `計算 key`,',
	'\t...OTHER_LABELS,',
	'} as const;',
].join('\n');

const DROP_TABLE = [{ constName: 'LP_DROP_LABELS', returnKey: 'lpDropLabels' }];
const DROP_RESOLVED = { LP_DROP_LABELS: { ok: 'これは載る' } };

describe('取りこぼし検出 gate (#4626)', () => {
	it('宣言 entry の構造抽出は parseBlock が扱えない書き方も数える', () => {
		const body = DROPPED_FIXTURE.slice(
			DROPPED_FIXTURE.indexOf('{') + 1,
			DROPPED_FIXTURE.lastIndexOf('}'),
		);
		assert.deepEqual(extractDeclaredEntryNames(body).sort(), [
			'...OTHER_LABELS',
			'[COMPUTED_KEY]',
			'ok',
			'quoted-key',
			'viaFn',
		]);
	});

	it('値を解決できず捨てられた key を全件報告し、assert は throw する', () => {
		const options = { table: DROP_TABLE, namespaceExclusions: {}, keyExclusions: {} };
		const result = findSilentDrops(DROPPED_FIXTURE, DROP_RESOLVED, options);
		assert.deepEqual(result.droppedKeys.sort(), [
			'LP_DROP_LABELS....OTHER_LABELS',
			'LP_DROP_LABELS.[COMPUTED_KEY]',
			'LP_DROP_LABELS.quoted-key',
			'LP_DROP_LABELS.viaFn',
		]);
		assert.throws(
			() => assertNoSilentDrops(DROPPED_FIXTURE, DROP_RESOLVED, options),
			/LP_DROP_LABELS\.viaFn/,
		);
	});

	it('理由付きの key 除外は通る', () => {
		const result = findSilentDrops(DROPPED_FIXTURE, DROP_RESOLVED, {
			table: DROP_TABLE,
			namespaceExclusions: {},
			keyExclusions: {
				'LP_DROP_LABELS.viaFn': '実行時計算のため LP へは配信しない',
				'LP_DROP_LABELS.quoted-key': '実行時計算のため LP へは配信しない',
				'LP_DROP_LABELS.[COMPUTED_KEY]': '実行時計算のため LP へは配信しない',
				'LP_DROP_LABELS....OTHER_LABELS': '実行時計算のため LP へは配信しない',
			},
		});
		assert.deepEqual(result.droppedKeys, []);
		assert.deepEqual(result.invalidExclusions, []);
	});

	it('配信表に無い LP_* namespace は取りこぼしとして報告する', () => {
		const src = "export const LP_ORPHAN_LABELS = {\n\tk1: 'みなしご',\n} as const;";
		const result = findSilentDrops(
			src,
			{},
			{
				table: [],
				namespaceExclusions: {},
				keyExclusions: {},
			},
		);
		assert.deepEqual(result.missingNamespaces, ['LP_ORPHAN_LABELS']);
	});

	it('理由なし / 短すぎる理由の除外は fail する', () => {
		const src = "export const LP_ORPHAN_LABELS = {\n\tk1: 'みなしご',\n} as const;";
		const ok = findSilentDrops(
			src,
			{},
			{
				table: [],
				keyExclusions: {},
				namespaceExclusions: { LP_ORPHAN_LABELS: 'アプリ内専用で LP には配信しないため' },
			},
		);
		assert.deepEqual(ok.missingNamespaces, []);
		assert.deepEqual(ok.invalidExclusions, []);

		for (const badReason of ['', 'TODO', '未定', 'n/a']) {
			const bad = findSilentDrops(
				src,
				{},
				{
					table: [],
					keyExclusions: {},
					namespaceExclusions: { LP_ORPHAN_LABELS: badReason },
				},
			);
			assert.deepEqual(
				bad.invalidExclusions,
				['LP_ORPHAN_LABELS'],
				`理由 ${JSON.stringify(badReason)} が受理されてしまった`,
			);
		}
	});

	it('もう該当しない除外エントリ (stale) も fail する', () => {
		const src = "export const LP_KEPT_LABELS = {\n\tk1: '配信中',\n} as const;";
		const result = findSilentDrops(
			src,
			{ LP_KEPT_LABELS: { k1: '配信中' } },
			{
				table: [{ constName: 'LP_KEPT_LABELS', returnKey: 'lpKeptLabels' }],
				namespaceExclusions: { LP_GONE_LABELS: 'すでに削除された namespace の除外' },
				keyExclusions: { 'LP_KEPT_LABELS.k1': 'もう解決できているのに残っている除外' },
			},
		);
		assert.deepEqual(result.staleExclusions.sort(), ['LP_GONE_LABELS', 'LP_KEPT_LABELS.k1']);
	});

	it('実 labels.ts では取りこぼし 0 件 (回帰ガード)', () => {
		const src = fs.readFileSync(
			new URL('../../src/lib/domain/labels.ts', import.meta.url),
			'utf-8',
		);
		const result = findSilentDrops(src, parseAllNamespacesResolved());
		assert.deepEqual(result.missingNamespaces, []);
		assert.deepEqual(result.droppedKeys, []);
		assert.deepEqual(result.invalidExclusions, []);
		assert.deepEqual(result.staleExclusions, []);
	});

	it('site/index.html hero の data-lp-key が生成物で解決できる (実害の回帰ガード)', () => {
		const resolved = parseAllNamespacesResolved();
		const html = fs.readFileSync(new URL('../../site/index.html', import.meta.url), 'utf-8');
		const heroKeys = [...html.matchAll(/data-lp-key="(hero[A-Za-z]*\.[^"]+)"/g)].map((m) => m[1]);
		assert.ok(heroKeys.length >= 9, `hero の data-lp-key が想定より少ない: ${heroKeys.length}`);
		/** @type {Record<string, string>} */
		const nsBySection = {
			heroPriceBand: 'LP_HERO_PRICE_BAND_LABELS',
			heroSpecBadges: 'LP_HERO_SPEC_BADGES_LABELS',
		};
		for (const dotted of heroKeys) {
			const [section, key] = dotted.split('.');
			const ns = nsBySection[section ?? ''];
			assert.ok(ns, `未知の hero section: ${dotted}`);
			assert.equal(
				typeof resolved[ns]?.[key ?? ''],
				'string',
				`${dotted} が生成物で解決できない (LP は HTML 直書きの文言を出し続ける)`,
			);
		}
	});
});
