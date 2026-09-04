// tests/unit/domain/age-tier-tone-4690.test.ts (#4690)
//
// 年齢帯ごとの文体 (docs/DESIGN.md §8) を機械検証する。実測されていた乖離:
//   - preschool (3-5 歳、ひらがなのみ) に漢字 — seed 活動名 / チャレンジ理由文 / 404 本文
//   - junior / senior (13-18 歳、漢字) に幼児向けひらがな — ショップ / ステータス /
//     ホームの記録ダイアログ・結果・must リボン
//
// 「今の値が正しいか」ではなく **禁止パターンの不在** を assert する。値の一致で書くと、
// 次に文言を変えたときにテストだけ直して乖離が戻る。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_CODES } from '../../../src/lib/domain/categories';
import {
	getCategoryDisplayName,
	getChallengeReason,
	getChildActivityEmptyLabels,
	getChildAdventureStartLabels,
	getChildChecklistLabels,
	getChildErrorPageLabels,
	getChildHomeLabels,
	getChildNavModeLabels,
	getChildParentMessageLabels,
	getChildShopLabels,
	getChildStampLabels,
	getChildStatusLabels,
} from '../../../src/lib/domain/labels';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** CJK 統合漢字。ひらがな / カタカナ / 記号 / 絵文字は含まない。 */
const KANJI = /[一-鿿]/;

/** 3-5 歳向け = ひらがなのみ。0-2 歳 (baby) は親の準備モードだが文体は同じ側に置く。 */
const HIRAGANA_MODES = ['baby', 'preschool'] as const;
/** 13-18 歳向け = 漢字・情報密度高。 */
const KANJI_MODES = ['junior', 'senior'] as const;

/** 文言セットから表示文字列だけを集める（関数は代表引数で 1 回評価する）。 */
function collectStrings(value: unknown, out: string[], depth = 0): void {
	if (depth > 4) return;
	if (typeof value === 'string') {
		out.push(value);
		return;
	}
	if (typeof value === 'function') {
		try {
			const result = (value as (...args: unknown[]) => unknown)('サンプル', 1, 1);
			if (typeof result === 'string') out.push(result);
		} catch {
			// 引数の形が違う関数は対象外（表示文字列を返さないので落とす必要がない）
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) collectStrings(v, out, depth + 1);
		return;
	}
	if (value && typeof value === 'object') {
		for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
	}
}

function stringsOf(value: unknown): string[] {
	const out: string[] = [];
	collectStrings(value, out);
	return out;
}

describe('#4690 F1: preschool に出る seed 活動名に漢字が残っていない', () => {
	it('ageMin <= 5 の seed 活動は、漢字を含むなら nameKana を持つ', () => {
		const src = readFileSync(resolve(REPO_ROOT, 'src/lib/server/db/seed.ts'), 'utf-8');

		// `name: '...'` から次の `name:` までを 1 活動のブロックとして切り出す。
		const positions: Array<{ name: string; idx: number }> = [];
		const re = /name:\s*'([^']*)'/g;
		let m = re.exec(src);
		while (m !== null) {
			positions.push({ name: m[1] ?? '', idx: m.index });
			m = re.exec(src);
		}

		const missing: string[] = [];
		for (let i = 0; i < positions.length; i += 1) {
			const start = positions[i]?.idx ?? 0;
			const end = positions[i + 1]?.idx ?? src.length;
			const block = src.slice(start, end);
			const ageMin = block.match(/ageMin:\s*(\d+)/);
			const hasKana = /nameKana:\s*'[^']*'/.test(block);
			const name = positions[i]?.name ?? '';
			if (!ageMin) continue;
			if (Number(ageMin[1]) <= 5 && KANJI.test(name) && !hasKana) missing.push(name);
		}

		expect(missing, `nameKana が無い漢字活動: ${missing.join(' / ')}`).toEqual([]);
	});
});

describe('#4690 F2: チャレンジ理由文が年齢帯で分かれている', () => {
	const MODES = ['weakness', 'strength', 'rescue-strength', 'explore'] as const;

	it('preschool 向けの理由文に漢字が出ない', () => {
		for (const mode of MODES) {
			for (const uiMode of HIRAGANA_MODES) {
				const text = getChallengeReason(mode, getCategoryDisplayName('undou', uiMode), uiMode);
				expect(text, `${mode}/${uiMode}: ${text}`).not.toMatch(KANJI);
			}
		}
	});

	it('junior / senior 向けの理由文は漢字を含む', () => {
		for (const mode of MODES) {
			for (const uiMode of KANJI_MODES) {
				const text = getChallengeReason(mode, getCategoryDisplayName('undou', uiMode), uiMode);
				expect(text, `${mode}/${uiMode}: ${text}`).toMatch(KANJI);
			}
		}
	});

	it('サービス層に理由文が直書きされていない', () => {
		const src = readFileSync(
			resolve(REPO_ROOT, 'src/lib/server/services/child-challenge-service.ts'),
			'utf-8',
		);
		expect(src).not.toContain('いろんなことにチャレンジしてみよう');
		expect(src).not.toContain('が少なめだったから');
		expect(src).not.toContain('をもっと伸ばしてみよう');
	});
});

describe('#4690 F3: 404 などのエラー文言が年齢帯で分かれている', () => {
	it('preschool のエラー文言に漢字が出ない', () => {
		for (const uiMode of HIRAGANA_MODES) {
			for (const text of stringsOf(getChildErrorPageLabels(uiMode))) {
				expect(text, `${uiMode}: ${text}`).not.toMatch(KANJI);
			}
		}
	});

	it('子供画面かどうかを URL からも判定している', () => {
		// role が解決できない 404 (子供 layout の load が走らない) で保護者文言が出ていた。
		const src = readFileSync(resolve(REPO_ROOT, 'src/routes/+error.svelte'), 'utf-8');
		expect(src).toContain('UI_MODES');
		expect(src).not.toMatch(/const isChild = \$derived\(role === 'child'\);/);
	});
});

describe('#4690 F4/F5/F6: junior / senior に幼児向けひらがなが残っていない', () => {
	/**
	 * ひらがなのまま残ってはいけない語。実測 SS で PO が指摘したもの。
	 * 「ごほうび」「おこづかい」「きょうだい」「もの」は製品固有の呼称として
	 * 全年齢で使う（ADR-0045 の atom 側で決まっている）ので対象にしない。
	 */
	const FORBIDDEN_IN_KANJI_MODE = [
		'いまのポイント',
		'こうかんする',
		'こうかんしますか',
		'いまこうかんできる',
		'おうちのひとにれんらくがいくよ',
		'やめる',
		'せいちょうチャート',
		'すごくのびたね',
		'のびしろがたくさん',
		'せんげつ',
		'きろくする？',
		'やったね！',
		'けいけんち',
		'かいめ！',
		'つかいかた ガイド あるよ',
		'チャレンジきろく',
		// #4841: 持ち物チェック / ログインボーナス受取 (押印演出・スタンプカード)
		'にちれんぞく',
		'おしたよ',
		'きょうはもうおした',
		'おうちの人に追加してもらおう',
		'ぜんぶできた',
		// #4841: 応援メッセージ dialog (ログインボーナスと同じ画面に出るので文体を割らない)
		'おうえんメッセージ',
		'パパ・ママ',
		'うれしい！',
		'もらったよ',
		// 初回の子供画面 (冒険スタート演出 / 活動 0 件の空状態)。
		// showAdventureStart は elementary / junior / senior に付いているので 16-18 歳が最初に見る。
		'したのカードをタップしてみてね',
		'きょうから いっしょに',
		'ぼうけんだよ！',
		'つよくなれるよ',
		'ぼうけんスタート',
		'ぼうけんの じゅんびちゅう',
		'よういしているよ',
		'もうすこし まってね',
	];

	it('ショップ / ステータス / ホーム / 持ち物チェック / ログインボーナス受取 / 初回画面の文言に禁止語が残っていない', () => {
		for (const uiMode of KANJI_MODES) {
			const texts = [
				...stringsOf(getChildShopLabels(uiMode)),
				...stringsOf(getChildStatusLabels(uiMode)),
				...stringsOf(getChildHomeLabels(uiMode)),
				...stringsOf(getChildNavModeLabels(uiMode)),
				// #4841: 持ち物チェック (`(child)/checklist`) とログインボーナス受取 UI
				...stringsOf(getChildChecklistLabels({ ageTier: uiMode })),
				...stringsOf(getChildStampLabels(uiMode)),
				...stringsOf(getChildParentMessageLabels(uiMode)),
				// 初回訪問で最初に出る 2 面 (冒険スタート演出 / 活動 0 件の空状態)
				...stringsOf(getChildAdventureStartLabels(uiMode)),
				...stringsOf(getChildActivityEmptyLabels(uiMode)),
			].join('\n');
			for (const word of FORBIDDEN_IN_KANJI_MODE) {
				expect(texts, `${uiMode} に「${word}」が残っている`).not.toContain(word);
			}
		}
	});

	it('preschool 側は従来どおりひらがなのまま（漢字変種が漏れていない）', () => {
		const texts = [
			...stringsOf(getChildShopLabels('preschool')),
			...stringsOf(getChildStatusLabels('preschool')),
		].join('\n');
		expect(texts).toContain('こうかんする');
		expect(texts).toContain('せいちょうチャート');
	});

	it('初回画面 (冒険スタート演出 / 活動 0 件の空状態) のひらがな側に漢字変種が漏れていない', () => {
		for (const uiMode of ['baby', 'preschool', 'elementary'] as const) {
			const texts = [
				...stringsOf(getChildAdventureStartLabels(uiMode)),
				...stringsOf(getChildActivityEmptyLabels(uiMode)),
			].join('\n');
			expect(texts, uiMode).toContain('したのカードをタップしてみてね');
			expect(texts, uiMode).toContain('ぼうけんの じゅんびちゅう');
			for (const value of ['下のカードを選んで記録してみよう', '冒険の準備中', '保護者が活動']) {
				expect(texts, `${uiMode} に漢字変種「${value}」が漏れている`).not.toContain(value);
			}
		}
	});

	it('初回画面は「押すカードが無いとき」の文言を別に持つ (下にカードが無いのに指さない)', () => {
		for (const uiMode of [...HIRAGANA_MODES, 'elementary', ...KANJI_MODES] as const) {
			const t = getChildAdventureStartLabels(uiMode);
			expect(t.adventureReadySubEmpty, uiMode).not.toBe(t.adventureReadySub);
			expect(t.adventureReadySubEmpty, uiMode).not.toContain('カード');
		}
	});

	it('カテゴリ名が年齢帯で切り替わる', () => {
		for (const code of CATEGORY_CODES) {
			expect(getCategoryDisplayName(code, 'preschool')).toBe(CATEGORIES[code].name);
			expect(getCategoryDisplayName(code, 'senior')).toBe(CATEGORIES[code].kanjiName);
			// 漢字表記は必ず漢字を含む（ひらがなのコピペ漏れを検出する）
			expect(CATEGORIES[code].kanjiName, code).toMatch(KANJI);
		}
	});

	it('legacy 数値 id / branded CategoryId 文字列からも引ける', () => {
		expect(getCategoryDisplayName(1, 'senior')).toBe(CATEGORIES.undou.kanjiName);
		expect(getCategoryDisplayName('1', 'senior')).toBe(CATEGORIES.undou.kanjiName);
		// 未知の値は空文字（呼び出し側が既存値へ fallback する）
		expect(getCategoryDisplayName('unknown-category', 'senior')).toBe('');
	});
});

describe('#4841: 持ち物チェック / ログインボーナス受取が年齢帯を持つ', () => {
	/** ひらがな側 (baby / preschool / elementary) に漢字変種が漏れていないこと。 */
	const KANJI_OVERRIDE_VALUES = ['OK', '全部達成！', '日連続！', '次へ', '今日は押印済み'];

	it('junior / senior のチェックリストが幼児文体に着地しない', () => {
		for (const uiMode of KANJI_MODES) {
			const t = getChildChecklistLabels({ ageTier: uiMode });
			expect(t.completeButton, uiMode).toBe('OK');
			expect(t.emptyDesc, uiMode).not.toContain('おうちの人');
			expect(t.dayNames[0], uiMode).toBe('日曜日');
		}
	});

	it('junior / senior のログインボーナス受取 (押印 / スタンプカード) が漢字文体になる', () => {
		for (const uiMode of KANJI_MODES) {
			const t = getChildStampLabels(uiMode);
			expect(t.stampPressStreakLabel(3), uiMode).toBe('3日連続！');
			expect(t.stampPressConfirmBtn, uiMode).toBe('OK');
			expect(t.stampPressNextBtn, uiMode).toBe('次へ');
			expect(t.stampCardStampedToday, uiMode).not.toContain('おした');
			expect(t.stampPressWeeklyCount(3, 5), uiMode).not.toContain('おしたよ');
		}
	});

	it('preschool / elementary は従来どおりひらがなのまま (漢字変種が漏れていない)', () => {
		for (const uiMode of ['baby', 'preschool', 'elementary'] as const) {
			const stamp = getChildStampLabels(uiMode);
			expect(stamp.stampPressStreakLabel(3), uiMode).toBe('3にちれんぞく！');
			expect(stamp.stampPressConfirmBtn, uiMode).toBe('やったね！');
			expect(stamp.stampCardStampedToday, uiMode).toContain('おした');
			const texts = stringsOf(stamp).join('\n');
			for (const value of KANJI_OVERRIDE_VALUES) {
				expect(texts, `${uiMode} に漢字変種「${value}」が漏れている`).not.toContain(value);
			}
		}
		// チェックリストは elementary が漢字ベース (#4509) なので、ひらがな判定は baby / preschool のみ
		for (const uiMode of HIRAGANA_MODES) {
			const t = getChildChecklistLabels({ ageTier: uiMode });
			expect(t.completeButton, uiMode).toBe('やったね！');
			expect(t.dayNames[0], uiMode).toBe('にちようび');
		}
	});

	it('ログインボーナス受取 UI が画面側で年齢帯を判定していない (labels SSOT 経由)', () => {
		for (const file of [
			'src/lib/ui/components/StampPressOverlay.svelte',
			'src/lib/ui/components/StampCard.svelte',
		]) {
			const src = readFileSync(resolve(REPO_ROOT, file), 'utf-8');
			expect(src, file).toContain('getChildStampLabels(uiMode)');
			// 画面側の年齢帯分岐 (アンチパターン A1) が再発していないこと
			expect(src, file).not.toMatch(/uiMode ===\s*'(baby|preschool|elementary|junior|senior)'/);
		}
	});
});
