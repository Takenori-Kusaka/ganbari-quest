// tests/unit/services/pin-redaction-callsites-source.test.ts
//
// PIN を含みうる文字列を外へ出す**呼び出し口**が、redact を通していることを固定する (#4867)。
//
// **この file は mock を持たない。** mock と module-level `await import` を持つ file の中に
// 同じ source 検査を置くと、mutation を当てても緑のまま通ることを実測している
// (2026-09-09、同 PR)。効くことを保証するために、検査だけを持つ file に分ける。
//
// **なぜ source を読むのか (限界の明示)**: build 失敗経路 (`drainPendingExports`) と
// 起票経路 (`createCloudExport`) は plan gate / claim / budget / storage の依存が深く、
// 「PIN が出ないこと」を確かめる目的に対して mock の量が釣り合わない。到達できる 2 経路
// (削除失敗 / 退会) は振る舞いで固定してある (`cloud-export-pin-not-logged` /
// `pin-not-logged-callsites`)。ここで見るのは**残り 2 経路の呼び出しの形**だけで、
// 変数に組んでから渡す形は見えない。
//
// 固定する不変条件:
//   [S1] build 失敗の `failureReason` は redact を通してから作る
//        (DB の failure_reason → **保護者の画面**に出る)
//   [S2] 起票ログは `pinCode` を渡さない
//   [S3] cloud-import の PIN 検索失敗ログは redact を通す

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const SERVICE = 'src/lib/server/services/cloud-export-service.ts';
const IMPORT_ROUTE = 'src/routes/api/v1/import/cloud/+server.ts';

describe('[S1] build 失敗の failureReason', () => {
	it('redact を通してから組み立てる (保護者の画面に出る文字列)', () => {
		const src = read(SERVICE);
		const m = src.match(/const failureReason =[\s\S]{0,400}?;/);
		expect(m?.[0], 'failureReason の組み立てが見つからない (実装が変わった?)').toBeDefined();
		expect(
			(m?.[0] ?? '').includes('redactStorageKeysInText'),
			'failureReason を redact していない。NUC の local FS backend では fs エラーが ' +
				'解決済み絶対パス (…/exports/<tenantId>/<PIN>/backup.zip) を含むため、' +
				'**親の画面に自分の共有 PIN が出る**',
		).toBe(true);
	});
});

describe('[S2] 起票ログ', () => {
	it('context に pinCode を渡さない', () => {
		const src = read(SERVICE);
		const leaked = src.match(/context:\s*\{[^}]*\bpinCode\b/);
		expect(leaked?.[0] ?? null, 'logger の context に pinCode を渡している').toBeNull();
	});

	it('起票ログは伏せた s3Key を持つ (完了 / 削除ログと join できる)', () => {
		const src = read(SERVICE);
		const m = src.match(/エクスポート起票[\s\S]{0,300}?\}\);/);
		expect(m?.[0], '起票ログが見つからない').toBeDefined();
		expect(
			(m?.[0] ?? '').includes('redactStorageKey(s3Key)'),
			'起票ログに export を一意に指す識別子が無い。完了 / 削除ログと突き合わせられない',
		).toBe(true);
	});
});

describe('[S3] cloud-import の PIN 検索失敗ログ', () => {
	it('例外 message を redact してから出す', () => {
		const src = read(IMPORT_ROUTE);
		const m = src.match(/const msg = [\s\S]{0,200}?;/);
		expect(m?.[0], 'msg の組み立てが見つからない').toBeDefined();
		expect(
			(m?.[0] ?? '').includes('redactStorageKeysInText'),
			'PIN を query 値として渡した先の例外 message は PIN をそのまま含みうる',
		).toBe(true);
	});
});
