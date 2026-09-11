/**
 * tests/unit/scripts/check-pr-screenshot.test.ts (#1766 / #1747 AC4)
 *
 * scripts/check-pr-screenshot.mjs の純粋関数（検出ロジック）の unit test。
 * メイン処理 (main) は env 経由で動作するため、export された関数を直接呼んで検証する。
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	checkRenderImpossibleDeclaration,
	checkScreenshotEmbedReadiness,
	detectBeforeAfterLabels,
	detectLocalPaths,
	extractImageUrls,
	hasDomSnapshotReference,
	hasEmbeddedScreenshotImage,
	hasFutureTenseScreenshotMarker,
	hasIntegrationVrEvidence,
	hasStorybookStoryReference,
	hasUiNotApplicableMarker,
	isScreenshotUrl,
	isUiPr,
	isUserAttachmentAssetUrl,
} from '../../../scripts/check-pr-screenshot.mjs';

describe('isUiPr (#1740)', () => {
	it('.svelte ファイルがあれば true', () => {
		expect(isUiPr(['src/routes/foo/+page.svelte'])).toBe(true);
	});

	it('.css / .scss があれば true', () => {
		expect(isUiPr(['src/lib/ui/styles/app.css'])).toBe(true);
		expect(isUiPr(['src/lib/foo.scss'])).toBe(true);
	});

	it('site/ 配下のファイルなら true', () => {
		expect(isUiPr(['site/index.html'])).toBe(true);
	});

	it('.ts のみ・docs のみは false', () => {
		expect(isUiPr(['src/lib/server/db/schema.ts'])).toBe(false);
		expect(isUiPr(['docs/design/06-UI設計書.md'])).toBe(false);
		expect(isUiPr(['scripts/capture.mjs'])).toBe(false);
	});
});

describe('detectLocalPaths (#1741)', () => {
	it('tmp/ パス Markdown 画像を検出', () => {
		const body = '![before-mobile](tmp/screenshots/pr-1/before-mobile.png)';
		expect(detectLocalPaths(body)).toHaveLength(1);
	});

	it('.tmp-screenshots/ パスを検出', () => {
		const body = '![x](.tmp-screenshots/foo.png)';
		expect(detectLocalPaths(body)).toHaveLength(1);
	});

	it('GitHub raw URL は false (検出されない)', () => {
		const body =
			'![ok](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1/ok.png)';
		expect(detectLocalPaths(body)).toHaveLength(0);
	});
});

describe('detectBeforeAfterLabels (#1740)', () => {
	it('before / after 両方検出', () => {
		const body = `
![before-mobile](https://example.com/b.png)
![after-mobile](https://example.com/a.png)
`;
		const result = detectBeforeAfterLabels(body);
		expect(result.hasBefore).toBe(true);
		expect(result.hasAfter).toBe(true);
	});

	it('日本語ラベル「修正前 / 修正後」も検出', () => {
		const body = `
![修正前](https://example.com/b.png)
![修正後](https://example.com/a.png)
`;
		const result = detectBeforeAfterLabels(body);
		expect(result.hasBefore).toBe(true);
		expect(result.hasAfter).toBe(true);
	});

	it('after だけのときは hasBefore=false', () => {
		const body = '![after-mobile](https://example.com/a.png)';
		const result = detectBeforeAfterLabels(body);
		expect(result.hasBefore).toBe(false);
		expect(result.hasAfter).toBe(true);
	});
});

describe('hasUiNotApplicableMarker', () => {
	it('「該当なし（refactor）」を検出', () => {
		expect(hasUiNotApplicableMarker('該当なし（refactor / docs / chore）')).toBe(true);
	});

	it('「UI 変更なし」を検出', () => {
		expect(hasUiNotApplicableMarker('## SS\nUI 変更なし')).toBe(true);
	});

	it('UI 変更がある PR は false', () => {
		expect(hasUiNotApplicableMarker('![ss](url)')).toBe(false);
	});

	// ---- #4255 横展開: 宣言の誤マッチで SS gate 全体が skip される ----
	//
	// 本 marker は成立すると `checkScreenshotEmbedReadiness` / CI screenshot-check の
	// **gate 全体を skip** させる。#4255 で直した `hasStorybookStoryReference` は
	// 「story 参照ありか」という 1 サブ検査の誤マッチだったのに対し、こちらは
	// **PR body のどこかに「UI 変更なし」の 6 文字が現れれば SS 検証がまるごと消える**。
	// 否定文・引用・コードブロック・未チェック checkbox のいずれで現れても成立していた。
	//
	// 「宣言していないのに宣言したことにされる」= 検査できていないのに pass。
	// #4084（ペア 0 件を skip）/ #4255（否定文に誤マッチ）と同 class の 3 回目。
	describe('#4255 横展開: 宣言でない出現を marker にしない', () => {
		it('否定文を宣言として扱わない（#4255 と同じ「〜ではありません」型）', () => {
			expect(
				hasUiNotApplicableMarker('本 PR は UI 変更なしではありません。文言を変更しています。'),
				'「UI 変更なしではない」と書いた PR の SS 検証が skip される',
			).toBe(false);
		});

		it('引用（blockquote）は宣言として扱わない', () => {
			expect(hasUiNotApplicableMarker('> UI 変更なしの PR は SS 不要\n\n本 PR は文言を変更')).toBe(
				false,
			);
		});

		it('コードブロック / インラインコード内の言及は宣言として扱わない', () => {
			const fenced = ['```', 'if (hasUiNotApplicableMarker(body)) // UI 変更なし', '```'].join(
				'\n',
			);
			expect(hasUiNotApplicableMarker(fenced)).toBe(false);
			expect(hasUiNotApplicableMarker('判定は `UI 変更なし` の有無で行う')).toBe(false);
		});

		// #4348: HTML コメントは顧客にも監査にも見えないので宣言ではない
		// (コメント除去は他の PR body gate と同じ規律に揃えた)。
		it('HTML コメント内の記述は宣言として扱わない', () => {
			expect(hasUiNotApplicableMarker('<!-- UI 変更なし の場合はここに書く -->')).toBe(false);
			expect(hasUiNotApplicableMarker('<!-- 該当なし（refactor / docs / chore） -->')).toBe(false);
		});

		it('**未チェックの checkbox は宣言として扱わない**（チェックしていない = 宣言していない）', () => {
			expect(hasUiNotApplicableMarker('- [ ] UI 変更なし')).toBe(false);
			expect(hasUiNotApplicableMarker('- [x] UI 変更なし')).toBe(true);
		});

		it('手順書の条件節（「UI 変更なしの場合: …」）を宣言として扱わない', () => {
			expect(
				hasUiNotApplicableMarker(
					'UI 変更なしの場合: 「**該当なし（バックエンド修正のみ）**」と明記。',
				),
			).toBe(false);
		});

		it('gate としても skip しない — UI 変更 PR が否定文で SS 検証を飛ばせない', () => {
			const result = checkScreenshotEmbedReadiness({
				body: '## スクリーンショット\n\n本 PR は UI 変更なしではありません。',
				files: ['src/routes/(parent)/admin/+page.svelte'],
				labels: [],
			});
			expect(result.skipped, 'SS gate が丸ごと skip されている').toBe(false);
			expect(result.violations.map((v) => v.id)).toContain('screenshot-embed-missing');
		});

		// 生成側 assert (#4255 / dev-session.md 指摘 class 2)。
		// テンプレートから生成しただけの PR body が marker を成立させると、
		// 「何も書いていない PR」が SS gate を素通りする。命名や文面を変えたときに
		// silent に壊れないよう、実テンプレートを読んで検証する。
		it('PR テンプレートを素で生成した body は marker を成立させない', () => {
			const templates = [
				'.github/PULL_REQUEST_TEMPLATE.md',
				'.claude/skills/dev-open-pr/templates/pr-body-default.md',
				'.claude/skills/dev-open-pr/templates/pr-body-critical-fix.md',
				'.claude/skills/dev-open-pr/templates/pr-body-lp.md',
				'.claude/skills/dev-open-pr/templates/pr-body-refactor-ssot.md',
			];
			for (const path of templates) {
				expect(
					hasUiNotApplicableMarker(readFileSync(path, 'utf8')),
					`${path} をそのまま出すだけで SS gate が skip される`,
				).toBe(false);
			}
		});
	});
});

// ---------------------------------------------------------------------------
// #1766 / #1747 AC4: DOM スナップショット参照検出
// ---------------------------------------------------------------------------

describe('extractImageUrls (#1766)', () => {
	it('Markdown 画像の URL を抽出', () => {
		const body = '![alt](https://example.com/foo.png)';
		expect(extractImageUrls(body)).toEqual(['https://example.com/foo.png']);
	});

	it('複数 Markdown 画像を抽出', () => {
		const body = `
![a](https://x.com/a.png)
![b](https://x.com/b.webp)
`;
		expect(extractImageUrls(body)).toEqual(['https://x.com/a.png', 'https://x.com/b.webp']);
	});

	it('HTML img タグからも URL を抽出', () => {
		const body = '<img src="https://x.com/bar.png" alt="bar">';
		expect(extractImageUrls(body)).toEqual(['https://x.com/bar.png']);
	});

	it('画像参照がない場合は空配列', () => {
		expect(extractImageUrls('Hello world')).toEqual([]);
	});
});

describe('isScreenshotUrl (#1766)', () => {
	it('.png は true', () => {
		expect(isScreenshotUrl('https://example.com/foo.png')).toBe(true);
	});

	it('.webp は true', () => {
		expect(isScreenshotUrl('https://example.com/foo.webp')).toBe(true);
	});

	it('.jpg / .jpeg は true', () => {
		expect(isScreenshotUrl('https://example.com/foo.jpg')).toBe(true);
		expect(isScreenshotUrl('https://example.com/foo.jpeg')).toBe(true);
	});

	it('.gif は true', () => {
		expect(isScreenshotUrl('https://example.com/foo.gif')).toBe(true);
	});

	it('クエリ文字列付き URL も判定可能', () => {
		expect(isScreenshotUrl('https://example.com/foo.png?v=123')).toBe(true);
		expect(isScreenshotUrl('https://example.com/foo.webp#frag')).toBe(true);
	});

	it('user-attachments の uuid (拡張子なし) は false (拡張子判定に限定。embed 判定は isUserAttachmentAssetUrl 側で許容 #2929)', () => {
		expect(
			isScreenshotUrl('https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb'),
		).toBe(false);
	});

	it('.dom.html は false', () => {
		expect(isScreenshotUrl('https://example.com/foo.dom.html')).toBe(false);
	});
});

describe('isUserAttachmentAssetUrl (#2929 項目 1)', () => {
	it('GitHub user-attachments の uuid URL は true', () => {
		expect(
			isUserAttachmentAssetUrl(
				'https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb',
			),
		).toBe(true);
	});

	it('http (非 https) は false', () => {
		expect(
			isUserAttachmentAssetUrl('http://github.com/user-attachments/assets/9c6c8430-1234'),
		).toBe(false);
	});

	it('user-attachments 以外の github.com URL は false', () => {
		expect(isUserAttachmentAssetUrl('https://github.com/Takenori-Kusaka/ganbari-quest')).toBe(
			false,
		);
		expect(
			isUserAttachmentAssetUrl(
				'https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1/a.png',
			),
		).toBe(false);
	});

	it('偽装ドメイン (github.com.evil.example) は false', () => {
		expect(
			isUserAttachmentAssetUrl('https://github.com.evil.example/user-attachments/assets/abc'),
		).toBe(false);
	});

	it('uuid 後に path / query が続く非正規形は false', () => {
		expect(
			isUserAttachmentAssetUrl('https://github.com/user-attachments/assets/abc/../../evil'),
		).toBe(false);
		expect(isUserAttachmentAssetUrl('https://github.com/user-attachments/assets/abc?x=1')).toBe(
			false,
		);
	});
});

describe('hasDomSnapshotReference (#1766 / #1747 AC4)', () => {
	it('Markdown link 形式の .dom.html を検出', () => {
		const body = '[DOM HTML](https://example.com/foo.dom.html)';
		expect(hasDomSnapshotReference(body)).toBe(true);
	});

	it('GitHub raw URL の .dom.html を検出', () => {
		const body = `[DOM](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1766/admin-home-mobile.dom.html)`;
		expect(hasDomSnapshotReference(body)).toBe(true);
	});

	it('素の URL（リンク化されていない）も検出', () => {
		const body = `参照: https://example.com/foo.dom.html`;
		expect(hasDomSnapshotReference(body)).toBe(true);
	});

	it('SS だけ・DOM 参照なしは false', () => {
		const body = `
![before-mobile](https://example.com/before.png)
![after-mobile](https://example.com/after.png)
`;
		expect(hasDomSnapshotReference(body)).toBe(false);
	});

	it('「dom.html」という単語が文中に出るだけでは false（URL 文脈が必要）', () => {
		const body = 'DOM スナップショット (.dom.html) は未対応';
		// URL ではなく説明文中の言及なので検出されない
		expect(hasDomSnapshotReference(body)).toBe(false);
	});

	// #4348 (対象 #4): 本文全体への 1 本の正規表現をやめ、行単位 + 文脈除外に揃える。
	// 「参照がある」と判定されると DOM 併記検証がまるごと消えるため、
	// **書いていない参照を書いたことにされる**経路を塞ぐ (#4255 / hasUiNotApplicableMarker と同型)。
	describe('行単位 + 文脈除外 (#4348 対象 #4)', () => {
		it('HTML コメント内の .dom.html URL は参照として扱わない', () => {
			const body =
				'![after](https://example.com/a.png)\n<!-- [DOM HTML](https://x/foo.dom.html) -->';
			expect(hasDomSnapshotReference(body)).toBe(false);
		});

		it('コードブロック内の .dom.html URL は参照として扱わない', () => {
			const body = ['```md', '[DOM HTML](https://example.com/foo.dom.html)', '```'].join('\n');
			expect(hasDomSnapshotReference(body)).toBe(false);
		});

		it('インラインコード内の .dom.html URL は参照として扱わない（書式の説明）', () => {
			expect(hasDomSnapshotReference('書式: `[DOM HTML](https://example.com/x.dom.html)`')).toBe(
				false,
			);
		});

		it('引用行 / 否定文の .dom.html URL は参照として扱わない', () => {
			expect(hasDomSnapshotReference('> [DOM](https://example.com/foo.dom.html) を貼ること')).toBe(
				false,
			);
			expect(
				hasDomSnapshotReference('https://example.com/foo.dom.html は撮れていないため添付ではない'),
			).toBe(false);
		});

		it('未チェック checkbox 行の .dom.html URL は参照として扱わない', () => {
			expect(hasDomSnapshotReference('- [ ] [DOM HTML](https://example.com/foo.dom.html)')).toBe(
				false,
			);
			expect(hasDomSnapshotReference('- [x] [DOM HTML](https://example.com/foo.dom.html)')).toBe(
				true,
			);
		});
	});
});

// ---------------------------------------------------------------------------
// #2918: SS embed 未完了 (未来形 / embed 不在) の検出 + Ready 化前ゲート
// ---------------------------------------------------------------------------

describe('hasFutureTenseScreenshotMarker (#2918)', () => {
	it('「screenshots branch へ push する」を検出', () => {
		expect(hasFutureTenseScreenshotMarker('SS は screenshots branch へ push する')).toBe(true);
	});

	it('「スクリーンショットは後で添付します」を検出', () => {
		expect(hasFutureTenseScreenshotMarker('スクリーンショットは後で添付します')).toBe(true);
	});

	it('「TODO: スクショ追加」を検出', () => {
		expect(hasFutureTenseScreenshotMarker('TODO: スクショ追加')).toBe(true);
	});

	it('「SS は別途撮影します」を検出', () => {
		expect(hasFutureTenseScreenshotMarker('SS は別途撮影します')).toBe(true);
	});

	it('embed 済みの完了形 PR body は false', () => {
		const body =
			'## SS\n![after-mobile](https://raw.githubusercontent.com/x/y/screenshots/pr-1/a.png)';
		expect(hasFutureTenseScreenshotMarker(body)).toBe(false);
	});
});

describe('hasEmbeddedScreenshotImage (#2918)', () => {
	it('GitHub raw URL の embed 画像があれば true', () => {
		const body =
			'![after](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1/after.png)';
		expect(hasEmbeddedScreenshotImage(body)).toBe(true);
	});

	it('HTML img の remote URL embed も true', () => {
		expect(hasEmbeddedScreenshotImage('<img src="https://example.com/a.webp">')).toBe(true);
	});

	it('ローカルパス参照のみは false (embed とみなさない)', () => {
		expect(hasEmbeddedScreenshotImage('![x](tmp/screenshots/pr-1/x.png)')).toBe(false);
	});

	it('テキストのみ・画像 0 件は false', () => {
		expect(hasEmbeddedScreenshotImage('## SS\n| 修正前 | 修正後 |\n|---|---|\n| a | b |')).toBe(
			false,
		);
	});

	it('拡張子なし user-attachments の uuid も embed として true (#2929 項目 1 — PR template / dev-session.md の正規手段案内と整合)', () => {
		expect(
			hasEmbeddedScreenshotImage(
				'![x](https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb)',
			),
		).toBe(true);
	});
});

describe('checkScreenshotEmbedReadiness (#2918 — Ready 化前ゲート)', () => {
	// case 1: UI 変更あり + SS embed なし → fail (違反検出)
	it('UI 変更あり + SS embed なし → violations を返す (fail)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '## 変更内容\nボタンの色を変えた。SS は後で push する。',
			files: ['src/routes/admin/+page.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		expect(result.violations.length).toBeGreaterThan(0);
		const ids = result.violations.map((v) => v.id);
		expect(ids).toContain('screenshot-embed-missing');
		expect(ids).toContain('future-tense-screenshot');
	});

	it('UI 変更あり + テキスト表のみ (embed 0 件) → fail (#2914 再現)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '## SS\n| 修正前 | 修正後 |\n|---|---|\n| 旧 | 新 |',
			files: ['src/lib/ui/primitives/Button.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		expect(result.violations.map((v) => v.id)).toContain('screenshot-embed-missing');
	});

	it('UI 変更あり + ローカルパス参照のみ → fail (#2913 再現)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '![before](tmp/screenshots/2894/before.png)',
			files: ['src/routes/admin/+page.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		const ids = result.violations.map((v) => v.id);
		// ローカルパス禁止 (#1741) + embed 不在 (#2918) の両方を検出
		expect(ids).toContain('local-path-forbidden');
		expect(ids).toContain('screenshot-embed-missing');
	});

	// case 2: UI 変更あり + SS embed あり → pass (違反なし)
	it('UI 変更あり + GitHub raw URL embed あり → 違反なし (pass)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '## SS\n![after-mobile](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-2918/after-mobile.png)',
			files: ['src/routes/admin/+page.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		expect(result.violations).toHaveLength(0);
	});

	it('UI 変更あり + user-attachments embed のみ → 違反なし (pass、#2929 項目 1 false-positive 解消)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '## SS\n![after-mobile](https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb)',
			files: ['src/routes/admin/+page.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		expect(result.violations).toHaveLength(0);
	});

	// case 3: docs-only → skip (UI 変更なしで検証スキップ)
	it('docs / .ts のみ変更 (UI 変更なし) → skip (違反なし)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '本文に embed 画像なし',
			files: ['docs/CLAUDE.md', 'src/lib/server/db/schema.ts'],
			labels: [],
		});
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe('UI 関連ファイル変更なし');
		expect(result.violations).toHaveLength(0);
	});

	it('UI 変更あり + 「該当なし（refactor）」明示 → skip', () => {
		const result = checkScreenshotEmbedReadiness({
			body: 'SS: 該当なし（refactor / docs / chore）',
			files: ['src/lib/ui/primitives/Button.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(true);
		expect(result.violations).toHaveLength(0);
	});

	it('UI 変更あり + refactor:internal-no-doc-impact ラベル → skip (exempt 互換維持)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '内部 refactor。SS は後で push する。', // 未来形があっても exempt label で skip
			files: ['src/lib/ui/primitives/Button.svelte'],
			labels: ['refactor:internal-no-doc-impact'],
		});
		expect(result.skipped).toBe(true);
		expect(result.violations).toHaveLength(0);
	});
});

// #2946 (Phase A/A-4): integration lane (統合 PR) の SS 観点切替 evidence 検出
describe('hasIntegrationVrEvidence (#2946 — integration lane SS 観点)', () => {
	it('VR 3 層 (visual regression) への言及があれば true', () => {
		expect(
			hasIntegrationVrEvidence(
				'統合状態の見た目回帰は VR 3 層 (lp / child-home / app の visual regression) で担保済み。',
			),
		).toBe(true);
	});

	it('*-visual-regression.yml workflow への言及があれば true', () => {
		expect(
			hasIntegrationVrEvidence(
				'app-visual-regression.yml / lp-visual-regression.yml が緑であることを確認。',
			),
		).toBe(true);
	});

	it('lp / child-home / app の visual / pixelmatch / baseline 言及があれば true', () => {
		expect(hasIntegrationVrEvidence('child-home visual baseline diff なし。')).toBe(true);
		expect(hasIntegrationVrEvidence('app pixelmatch baseline 比較で回帰未検出。')).toBe(true);
	});

	it('`## 含有 PR 一覧` section に含有 PR の行があれば true', () => {
		const body = ['## 含有 PR 一覧', '', '- #3001 活動追加', '- #3002 ごほうび修正'].join('\n');
		expect(hasIntegrationVrEvidence(body)).toBe(true);
	});

	it('取込時 SS 検証済の宣言があれば true', () => {
		expect(hasIntegrationVrEvidence('各 PR は develop 取り込み時に SS 検証済み。')).toBe(true);
		expect(hasIntegrationVrEvidence('含有 PR は取込済で個別に SS 検証されている。')).toBe(true);
	});

	it('統合 smoke への言及があれば true', () => {
		expect(hasIntegrationVrEvidence('統合 smoke を実行し問題なし。')).toBe(true);
	});

	// #4348 (対象 #4): 旧実装は本文全体に 6 本の正規表現を当てるだけで、
	// 「含有 PR」「統合対象」の 4 文字が本文のどこか (説明文 / HTML コメント / 引用) にあれば
	// 緑になっていた。統合 PR template はその 4 文字を 3 通りで含むため、
	// **統合 PR は VR 証跡の有無に関係なく常に緑**だった (#4333 と同じ形)。
	describe('行単位 + 構造判定 (#4348 対象 #4)', () => {
		it('PR を束ねる自己紹介文だけでは false (evidence ではない)', () => {
			expect(
				hasIntegrationVrEvidence('本 PR は統合対象 PR 群を束ねる develop→main 統合 PR。'),
			).toBe(false);
			expect(hasIntegrationVrEvidence('含有 PR 一覧は B-3 が自動生成します。')).toBe(false);
		});

		it('HTML コメント / 引用 / 否定文の言及は evidence として扱わない', () => {
			expect(hasIntegrationVrEvidence('<!-- visual regression の結果をここに書く -->')).toBe(false);
			expect(hasIntegrationVrEvidence('> visual regression の結果を貼ること')).toBe(false);
			expect(hasIntegrationVrEvidence('本 PR は visual regression の対象ではない')).toBe(false);
		});

		it('`## 含有 PR 一覧` が空 (見出しだけ) なら false', () => {
			expect(hasIntegrationVrEvidence('## 含有 PR 一覧\n\n<!-- B-3 が自動生成 -->')).toBe(false);
		});

		// 生成側 assert: 統合 PR template を素で出しただけで evidence 成立させない (#4348 AC7)。
		it('統合 PR テンプレートを素で生成した body は evidence を成立させない', () => {
			expect(
				hasIntegrationVrEvidence(readFileSync('.github/INTEGRATION_PR_TEMPLATE.md', 'utf8')),
				'template を貼るだけで統合 PR の SS 観点検証が緑になる',
			).toBe(false);
		});
	});

	it('generic な本文 (VR 言及 / 含有 PR / 取込検証なし) なら false', () => {
		expect(hasIntegrationVrEvidence('機能を実装しました。テストも追加しました。')).toBe(false);
		expect(hasIntegrationVrEvidence('')).toBe(false);
	});

	it('before/after 画像だけでは false (統合 PR は per-PR before/after を evidence と認めない)', () => {
		expect(
			hasIntegrationVrEvidence(
				'![before-mobile](https://example.com/a.png)\n![after-mobile](https://example.com/b.png)',
			),
		).toBe(false);
	});
});

// #2946: lane=integration での main() 挙動 (before/after でなく VR evidence を要求)
describe('check-pr-screenshot lane-aware main (#2946)', () => {
	// main() は env 経由のため、ここでは lane 切替の核となる pure 関数の合成挙動を確認する。
	// (main() 自体の exit code は CLI 統合で別途検証 — 純粋関数 SSOT を共有しているため二重実装しない)

	it('integration lane: UI 変更ありでも VR evidence があれば違反相当の判定にならない', () => {
		// integration では before/after 不要 → VR evidence の有無のみが判定軸
		const bodyWithEvidence =
			'統合 PR。VR 3 層 (visual regression) 緑、含有 PR すべて取込時 SS 検証済。';
		expect(hasIntegrationVrEvidence(bodyWithEvidence)).toBe(true);
		// before/after ラベルは integration では参照されないことを明示 (feature lane との差)
		expect(detectBeforeAfterLabels(bodyWithEvidence)).toEqual({
			hasBefore: false,
			hasAfter: false,
		});
	});

	it('feature lane の before/after 検証は従来通り (回帰ゼロ、AC4)', () => {
		// feature lane では before/after 両方が必要 (従来挙動)
		const fullBody =
			'![before-mobile](https://example.com/before.png)\n![after-mobile](https://example.com/after.png)';
		expect(detectBeforeAfterLabels(fullBody)).toEqual({ hasBefore: true, hasAfter: true });
		// VR evidence は feature lane では不要 (false でも feature lane は before/after で判定)
		expect(hasIntegrationVrEvidence(fullBody)).toBe(false);
	});
});

describe('ss-render-impossible 宣言 (#4087)', () => {
	// 「UI は変わるが、その環境では原理的に描画できない」に対する語彙。
	// 兄弟 gate (ss-blob-sha-uniqueness) には理由必須の宣言が 4 種あるのに本 gate だけ無く、
	// 「UI 変更なし」と嘘を書くか label の意味を曲げるかしか道が無かった (#4084 / PO 決裁 2026-08-01)。
	// #4255: story 参照は **実在する `*.stories.svelte` のパス**で書く。
	// タイトルだけ (`Features/Admin/BackupHealthCard`) は実在確認ができず、
	// 「それっぽい文字列を書けば通る」に戻るため受理しない (判定の厳格化であって弱体化ではない)。
	const STORY_REF =
		'Storybook の src/lib/features/admin/components/BackupHealthCard.stories.svelte で 4 状態を確認できます';

	it('宣言が無ければ何も起きない (既存 PR に影響しない)', () => {
		expect(checkRenderImpossibleDeclaration('本文だけ').ok).toBe(false);
		expect(checkRenderImpossibleDeclaration('本文だけ').violation).toBeUndefined();
	});

	it('理由 + story 参照が揃えば exempt になる', () => {
		const body = `<!-- ss-render-impossible: DATA_SOURCE=pglite でのみ描画され demo 環境では出ない -->
${STORY_REF}`;
		expect(checkRenderImpossibleDeclaration(body).ok).toBe(true);
	});

	it('**理由が定型 stub なら受理しない** (理由の非強制を作らない、#3956 教訓)', () => {
		for (const stub of ['', 'TODO', 'n/a', 'なし']) {
			const body = `<!-- ss-render-impossible: ${stub} -->
${STORY_REF}`;
			const r = checkRenderImpossibleDeclaration(body);
			expect(r.ok).toBe(false);
			expect(r.violation?.id).toBe('ss-render-impossible-reason-missing');
		}
	});

	it('理由が短すぎれば受理しない', () => {
		const body = `<!-- ss-render-impossible: 撮れない -->
${STORY_REF}`;
		const r = checkRenderImpossibleDeclaration(body);
		expect(r.ok).toBe(false);
		expect(r.violation?.id).toBe('ss-render-impossible-reason-missing');
	});

	it('**story 参照が無ければ宣言だけでは通さない** — 「撮れない」は「見なくてよい」ではない', () => {
		const body =
			'<!-- ss-render-impossible: DATA_SOURCE=pglite でのみ描画され demo 環境では出ない -->';
		const r = checkRenderImpossibleDeclaration(body);
		expect(r.ok).toBe(false);
		expect(r.violation?.id).toBe('ss-render-impossible-story-missing');
	});

	it('story 参照は *.stories.svelte のパス言及でも受理する', () => {
		const body =
			'<!-- ss-render-impossible: DATA_SOURCE=pglite でのみ描画され demo 環境では出ない -->\n' +
			'src/lib/features/admin/components/BackupHealthCard.stories.svelte を追加';
		expect(checkRenderImpossibleDeclaration(body).ok).toBe(true);
	});

	it('hasStorybookStoryReference: 無関係な本文では false', () => {
		expect(hasStorybookStoryReference('ただの説明文です')).toBe(false);
	});

	// ---- #4255: 誤マッチで gate が素通りした実例を固定する ----
	//
	// PR #4235（課金導線の文言変更）は body に **「Storybook story は本変更に対応するものが
	// ありません」と明記**していたのに、`screenshot-check` が pass した。旧判定が
	// 「`story` の語 + どこかに `word/word` があれば true」だったため、GitHub の
	// `Takenori-Kusaka/ganbari-quest` 等に誤マッチしていた。
	//
	// **SS 証跡ゼロの PR が「証跡あり」に見えた**ので、#4084（ペア 0 件を skip で通した）と
	// 同 class の 2 回目にあたる。判定できないときは fail に倒す。
	describe('#4255 誤マッチ防止（negative fixture）', () => {
		it('「story は無い」と書いてある body を true にしない（PR #4235 の実 body 抜粋）', () => {
			const body = [
				'## スクリーンショット / ビジュアルデモ',
				'',
				'<!-- ss-render-impossible: Stripe Portal は外部 SaaS で demo 環境から到達できない -->',
				'',
				'Storybook story は本変更に対応するものがありません。',
				'',
				'関連: https://github.com/Takenori-Kusaka/ganbari-quest/pull/4166',
			].join(String.fromCharCode(10));
			expect(
				hasStorybookStoryReference(body),
				'「story が無い」と書いた body を story 参照ありと判定している（#4255 の誤マッチ）',
			).toBe(false);
			// gate としても落ちること（判定関数だけ直して gate が通ると意味がない）
			const r = checkRenderImpossibleDeclaration(body);
			expect(r.ok).toBe(false);
			expect(r.violation?.id).toBe('ss-render-impossible-story-missing');
		});

		it('story タイトルだけの言及は受理しない（パスで書かせる）', () => {
			// 旧実装はこれを true にしていた。タイトルは実在確認ができない。
			expect(
				hasStorybookStoryReference('Storybook の Features/Admin/BackupHealthCard を参照'),
			).toBe(false);
		});

		it('実在しない *.stories.svelte のパスは受理しない', () => {
			expect(
				hasStorybookStoryReference('src/lib/features/admin/components/NoSuchThing.stories.svelte'),
				'実在しない story を書けば通る = 検査が空洞化する',
			).toBe(false);
		});

		it('実在する *.stories.svelte のパスは受理する', () => {
			expect(
				hasStorybookStoryReference(
					'src/lib/features/admin/components/BackupHealthCard.stories.svelte を追加',
				),
			).toBe(true);
		});
	});
});
