// tests/unit/architecture/setup-wizard-back-links-4863.test.ts
//
// cspell:ignore larr
// ↑ `&larr;` は戻る導線の HTML entity。全 step 共通のマークアップ目印として検査に使うので、
//   綴りを変えると検査そのものが効かなくなる (global words には足さない = file scope に閉じる)。
//
// セットアップウィザードの「戻る」が **step 連鎖と一致している**ことを固定する
// (#4863 / PO 決裁 2026-09-09)。
//
// なぜ要るか: 戻り先は各 page に**べた書き**されている。step を後から足したとき、
// 足した step の前後 2 本を直さないと静かにずれる。実際そうなっていた:
//
//   packs の戻り先が `/setup/children` (= step 1) を指していた
//   → questionnaire (step 2) を後から足したときの追従漏れ。戻ると step 2 を飛ばす
//   → questionnaire / first-adventure には戻る導線が無かった
//
// 中断者をウィザードへ戻す (#4863 Q2 = PO 決裁 (b)) 以上、その人は必ずこの「戻る」を踏む。
//
// 本 test は **layout が持つ step 配列 (`src/routes/setup/+layout.svelte` の `steps`) を
// 唯一の真実**として、各 page の戻り先がその 1 つ前と一致するかを見る。step を足したら、
// 配列を直した時点で本 test が「どの page の戻り先がずれているか」を名指しする。
//
// **この test が見ているのは markup に書かれた行き先だけで、描画は見ていない**
// (adversarial 実測: 戻るリンクを `{#if false}` で包んでも、HTML コメントで囲って描画を
// 消しても 12/12 緑のまま通る)。`docs/rationale/18-…` が「source を正規表現で読む」案を
// 棄却しているのと同じ弱さを、この test も持っている — **行き先のずれ**という
// 元の欠陥 (packs が step 2 を飛ばしていた) には効くが、**描画の有無**には効かない。
// 描画は `tests/e2e/demo-lambda/setup-wizard-navigation.spec.ts` が実ブラウザで見る
// (demo 環境では `/setup/*` が 200 で返る — setup gate は `authMode === 'local'` の内側に
// しか無いため)。
//
// 固定する不変条件:
//   [B1] layout の step 配列が、実装の redirect 連鎖と同じ順序である
//   [B2] 2 番目以降の step は戻る導線を持ち、その href が 1 つ前の step と一致する
//   [B3] step 1 (children) は戻る導線を持たない (ウィザードの入口。出口は #4860 が別に持つ)
//   [B4] 最後の step (complete) は戻る導線を持たない (印を降ろしたあとで、戻っても gate に弾かれる)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), 'utf8');
}

/** layout の `steps` 配列から step の path を順に取り出す (この配列が SSOT)。 */
function layoutStepPaths(): string[] {
	const src = read('src/routes/setup/+layout.svelte');
	const block = src.slice(
		src.indexOf('const steps = ['),
		src.indexOf('];', src.indexOf('const steps = [')),
	);
	return [...block.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1] as string);
}

/** page の markup から「/setup/... へ戻る」リンクの href を取り出す。 */
function backHrefOf(stepPath: string): string | null {
	const src = read(`src/routes${stepPath}/+page.svelte`);
	// 戻る導線は `<a href="/setup/...">` + `&larr;` の組で書く (全 step 共通のパターン)
	const anchors = [...src.matchAll(/<a\b[\s\S]*?<\/a>/g)].map((m) => m[0]);
	for (const a of anchors) {
		if (!a.includes('&larr;')) continue;
		// eslint (`svelte/no-navigation-without-resolve`) が `resolve()` を要求するので、
		// `href={resolve('/setup/xxx')}` の形を読む
		const href = a.match(/href=\{resolve\('(\/setup\/[a-z-]+)'\)\}/);
		if (href) return href[1] as string;
	}
	return null;
}

describe('[B1] layout の step 配列が実装の遷移順と一致する', () => {
	it('各 step の action の redirect 先が、配列の次の step である', () => {
		const steps = layoutStepPaths();
		// 実装から読んだ遷移順 (各 +page.server.ts の redirect 先)。
		// ここがずれていたら layout の表示順か実装のどちらかが嘘をついている。
		const expected = [
			'/setup/children',
			'/setup/questionnaire',
			'/setup/packs',
			'/setup/rewards',
			'/setup/rules',
			'/setup/activities-defaults',
			'/setup/challenges',
			'/setup/first-adventure',
			'/setup/complete',
		];
		expect(steps, 'layout の steps が実装の遷移順と違う').toEqual(expected);
	});
});

describe('[B2][B3][B4] 戻る導線が step 連鎖と一致する', () => {
	const steps = layoutStepPaths();

	it('step 1 (children) は戻る導線を持たない', () => {
		expect(
			backHrefOf('/setup/children'),
			'ウィザードの入口に「戻る」がある (出口は #4860 の canReturnHome が別に持つ)',
		).toBeNull();
	});

	it('最後の step (complete) は戻る導線を持たない', () => {
		expect(
			backHrefOf('/setup/complete'),
			'complete で印は降りているので、戻っても gate に弾かれる。行けない先を出さない',
		).toBeNull();
	});

	for (let i = 1; i < 8; i++) {
		const step = steps[i] as string;
		const prev = steps[i - 1] as string;
		it(`${step} の戻り先は ${prev}`, () => {
			const href = backHrefOf(step);
			expect(href, `${step} に戻る導線が無い (中断者はここで行き止まりになる)`).not.toBeNull();
			expect(
				href,
				`${step} の戻り先が step 連鎖の 1 つ前と違う。step を足したときの追従漏れ ` +
					'(packs が children を指して questionnaire を飛ばしていたのがこの形)',
			).toBe(prev);
		});
	}
});

describe('[B5] スキップだけで complete まで着く (印が降りる)', () => {
	// PO 決裁 (2026-09-09) の条件: 中断者をウィザードへ戻す以上、「もういい」と思った人が
	// **スキップを押し続けるだけで complete に着き、印が降りる**ことが要る。着かなければ
	// 印が立ったまま残り、Q3 (掃除しない) の前提が崩れる。
	//
	// 各 step の skip / next action の redirect 先を source から辿って、連鎖が complete に
	// 着くことを確かめる (実際の HTTP を通さない代わりに、行き先の文字列を全部辿る)。
	const FORWARD: Record<string, string> = {
		'/setup/children': '/setup/questionnaire',
		'/setup/questionnaire': '/setup/packs',
		'/setup/packs': '/setup/rewards',
		'/setup/rewards': '/setup/rules',
		'/setup/rules': '/setup/activities-defaults',
		'/setup/activities-defaults': '/setup/challenges',
		'/setup/challenges': '/setup/first-adventure',
		'/setup/first-adventure': '/setup/complete',
	};

	it('各 step の server が、次の step への redirect を実際に持っている', () => {
		for (const [from, to] of Object.entries(FORWARD)) {
			// 改行と空白を落としてから見る。redirect は 1 行のことも複数行のこともあり、
			// 行き先に query が付くこともある (`/setup/rules?rewardsImported=…`)。
			const src = read(`src/routes${from}/+page.server.ts`).replace(/\s+/g, '');
			const hasForward =
				src.includes(`redirect(302,'${to}`) || src.includes(`redirect(302,\`${to}`);
			expect(hasForward, `${from} から ${to} への redirect が無い (連鎖が切れている)`).toBe(true);
		}
	});

	it('連鎖を辿ると complete に着く (どこにも行き止まりが無い)', () => {
		let at = '/setup/children';
		const seen = new Set<string>([at]);
		for (let i = 0; i < 20 && at !== '/setup/complete'; i++) {
			const next = FORWARD[at];
			expect(next, `${at} から先が無い`).toBeDefined();
			at = next as string;
			expect(seen.has(at), `連鎖が ${at} で循環している`).toBe(false);
			seen.add(at);
		}
		expect(at, 'スキップを押し続けても complete に着かない = 印が降りない').toBe('/setup/complete');
		expect(seen.size, '9 step すべてを通っていない').toBe(9);
	});
});
