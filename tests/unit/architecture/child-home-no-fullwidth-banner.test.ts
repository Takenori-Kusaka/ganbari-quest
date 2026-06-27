// tests/unit/architecture/child-home-no-fullwidth-banner.test.ts
// #3333 (ADR-0061 same-class-N→guard / fitness function): 子供 home に独立横長 banner を
// 残置 / 新設できないことを per-PR の unit fitness function で機械強制する。
//
// 背景 (root class): child home の独立横長 alert/banner は #2146 (MustProgressBar →
// ActivityCard カード演出統合) / #2168 (MilestoneBanner 横長 alert → bell+dot badge) で
// 2 度撤去された。しかし「横長バナーをカード演出に統合する」原則が **人の注意依存**で
// 機械検証されておらず、ChallengeBanner だけが思想の取り残しとして残存し、さらに #3195 で
// home load 毎の child_challenge 自動生成により**全 child 常時表示**へ悪化した (#3333)。
// root class = 「child home に独立横長 banner コンポーネントを mount できてしまう」構造。
//
// 対策: 子供 home (`+page.svelte`) と共通 dashboard (`ProdDashboardSections.svelte`) の
// markup を静的解析し、denylist の横長 banner コンポーネントが mount されていないことを
// hard-fail で守る。チャレンジ対象は CategorySection ヘッダーのカード演出
// (challenge-target-badge) で表現する設計に固定する。fast 層 (vitest + node fs) で完結し
// heavy build/e2e に依存しない (push-down-pyramid)。route-db-boundary.test.ts (#3152) /
// page-guide-bracket-static-import.test.ts (#3314) と同型の Architecture Fitness Function
// (Building Evolutionary Architecture / Neal Ford 他)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// child home の UI 経路を構成する markup ファイル群 (ADR-0046 / #2084: 共通 dashboard は
// ProdDashboardSections に集約)。
const CHILD_HOME_MARKUP = [
	'src/routes/(child)/[uiMode=uiMode]/home/+page.svelte',
	'src/lib/features/child-home/components/ProdDashboardSections.svelte',
];

// 子供 home に mount してはならない独立横長 banner コンポーネント (root class lock)。
// チャレンジ対象は CategorySection のカード演出 (challenge-target-badge) で表現する。
// 新たな横長 banner を child home に出したくなった場合は、まず本 denylist と #2146/#2168 の
// カード演出統合思想 (docs/DESIGN.md §10 構造的ルール) を見直すこと。
const DENYLISTED_BANNER_COMPONENTS = ['ChallengeBanner', 'MustProgressBar', 'MilestoneBanner'];

/** ブロック / 行コメントを除去する (コメント内の言及を誤検出しないため)。 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('child home fitness function — 独立横長 banner 残置禁止 (#3333 / ADR-0061)', () => {
	for (const rel of CHILD_HOME_MARKUP) {
		it(`${rel} は denylist の横長 banner を import / mount しない`, () => {
			const source = stripComments(readFileSync(resolve(REPO_ROOT, rel), 'utf-8'));
			for (const comp of DENYLISTED_BANNER_COMPONENTS) {
				// import 文 (`import X from ...`) と element mount (`<X`) の双方を禁止。
				const importRe = new RegExp(`import\\s+${comp}\\s+from`);
				const mountRe = new RegExp(`<${comp}[\\s/>]`);
				expect(
					importRe.test(source),
					`${rel} が ${comp} を import している。child home の横長 banner はカード演出へ統合する (#2146/#2168/#3333)。`,
				).toBe(false);
				expect(
					mountRe.test(source),
					`${rel} が <${comp}> を mount している。child home の横長 banner はカード演出へ統合する (#2146/#2168/#3333)。`,
				).toBe(false);
			}
		});
	}

	it('削除済み ChallengeBanner コンポーネントが復活していない', () => {
		// ファイル自体が再追加されていないことを保証 (存在すれば readFileSync が成功してしまうため
		// fs.existsSync 相当を try/catch で検査)。
		let exists = true;
		try {
			readFileSync(resolve(REPO_ROOT, 'src/lib/ui/components/ChallengeBanner.svelte'), 'utf-8');
		} catch {
			exists = false;
		}
		expect(
			exists,
			'ChallengeBanner.svelte が復活している。チャレンジ対象は CategorySection のカード演出で表現する (#3333)。',
		).toBe(false);
	});
});
