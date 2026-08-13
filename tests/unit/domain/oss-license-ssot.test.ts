// tests/unit/domain/oss-license-ssot.test.ts (#4547)
//
// リポジトリの実ライセンス (package.json の "license") と、それを顧客に向けて
// 表示している全箇所 (LP labels / LP HTML の SEO フォールバック / README) が
// 一致していることを機械検証する。
//
// これが無いと「LICENSE / package.json を変えても LP の表示だけ旧ライセンスのまま」
// という乖離が、次に顧客の目に触れるまで誰にも気づかれない。#4499 (GAMMA-SELFHOST-01)
// では実体が AGPL-3.0-only なのに LP が「MIT License」と表示しており、是正した時点でも
// 再発を検出する仕組みは無かった (#4322 で LP 整合検査 script が削除済み)。
//
// SPDX の `-only` / `-or-later` は拘束力が異なる別識別子なので、短縮形 ('AGPL-3.0') への
// 緩和は行わず、package.json と 1 文字も違わない完全形での一致を要求する。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LP_SELFHOST_LABELS } from '../../../src/lib/domain/labels';
import { OSS_LICENSE_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const read = (relPath: string) => readFileSync(resolve(repoRoot, relPath), 'utf-8');

const packageLicense = (JSON.parse(read('package.json')) as { license: string }).license;

describe('OSS ライセンス表記 SSOT (#4547)', () => {
	it('atom (OSS_LICENSE_TERMS.spdxId) が package.json の license と完全一致する', () => {
		// 短縮形へのフォールバックを許さない (SPDX -only / -or-later は別ライセンス)
		expect(OSS_LICENSE_TERMS.spdxId).toBe(packageLicense);
	});

	it('package.json の license が SPDX 完全形である (-only / -or-later が付く)', () => {
		// AGPL / GPL / LGPL 系は完全形でないと拘束力が確定しない
		if (/^(A|L)?GPL-/.test(packageLicense)) {
			expect(packageLicense).toMatch(/-(only|or-later)$/);
		}
	});

	it('LICENSE ファイルが宣言ライセンスと同じ本文・同じ版である', () => {
		// 法的拘束力の実体は LICENSE 全文であり package.json のメタデータではない。
		// 系統名 ('AGPL') の部分文字列一致だけでは、AGPL に言及するだけの別文書や
		// 別版 (v2 等) に差し替わっても PASS してしまうため、正式名称 + 版数まで見る。
		const [family, version] = packageLicense.split('-'); // 'AGPL-3.0-only' -> ['AGPL', '3.0']
		const officialName: Record<string, string> = {
			AGPL: 'GNU AFFERO GENERAL PUBLIC LICENSE',
			GPL: 'GNU GENERAL PUBLIC LICENSE',
			LGPL: 'GNU LESSER GENERAL PUBLIC LICENSE',
		};
		const licenseText = read('LICENSE');
		const expectedName = officialName[family ?? ''];
		if (expectedName === undefined) {
			// GNU 系以外は正式名称表を持たないため、SPDX id そのものの出現を要求する
			expect(licenseText).toContain(packageLicense.replace(/-(only|or-later)$/, ''));
			return;
		}
		expect(licenseText).toContain(expectedName);
		// 'Version 3, 19 November 2007' の major を照合する ('3.0' -> '3')
		expect(licenseText).toContain(`Version ${(version ?? '').split('.')[0]}`);
	});

	it('LP のライセンス表示 (labels.ts compound) が atom 経由で実ライセンスを名乗る', () => {
		expect(LP_SELFHOST_LABELS.text23).toContain(OSS_LICENSE_TERMS.spdxId);
		expect(LP_SELFHOST_LABELS.licenseObligationNote).toContain(OSS_LICENSE_TERMS.spdxId);
	});

	it('LP HTML の SEO フォールバックが labels.ts の生成値と一致する', () => {
		// shared-labels.js を読めないブラウザ / クローラは HTML 直書きの方を見るため、
		// 片方だけ更新されると JS の有無で表示が食い違う (#4513 と同じ落とし穴)
		const html = read('site/selfhost.html');
		expect(html).toContain(LP_SELFHOST_LABELS.text23.trim());
		expect(html).toContain(LP_SELFHOST_LABELS.licenseObligationNote);
	});

	it('生成済み LP labels (site/shared-labels.js) が実ライセンスを配信している', () => {
		const sharedLabels = read('site/shared-labels.js');
		expect(sharedLabels).toContain(LP_SELFHOST_LABELS.text23);
		expect(sharedLabels).toContain(LP_SELFHOST_LABELS.licenseObligationNote);
	});

	it('README のライセンス表記が実ライセンスと一致する (badge + 本文)', () => {
		const readme = read('README.md');
		// shields.io の badge は `-` を `--` にエスケープする
		const badgeEscaped = packageLicense.replace(/-/g, '--');
		expect(readme).toContain(`license-${badgeEscaped}-blue.svg`);
		expect(readme).toContain(`[${packageLicense}](./LICENSE)`);
	});

	it('LP のメリット一覧に義務の記述が混入していない (義務は注記側に分離する)', () => {
		// 「メリット」見出し配下の箇条書きに義務を書くと、直前の「カスタマイズ自由」と
		// 印象が衝突する。義務は消さずに一覧の外の注記へ置く (#4547 問題 3)
		expect(LP_SELFHOST_LABELS.text23).not.toContain('義務');
		expect(LP_SELFHOST_LABELS.licenseObligationNote).toContain('義務');
	});
});
