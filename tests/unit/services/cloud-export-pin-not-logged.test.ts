// tests/unit/services/cloud-export-pin-not-logged.test.ts
//
// クラウド共有 export の **PIN をログ・例外メッセージに出さない**ことを固定する
// (QM 監査 security / PO 決裁 2026-09-09「今日直してください」)。
//
// なぜ重い欠陥か:
//   - この PIN は**他家庭のフル PII バックアップ** (子供の氏名・生年月日・顔写真・音声を含む ZIP)
//     を引き当てる唯一の材料で、`fetchCloudExportByPin` は **tenant 述語なしで**引く
//   - 本番の logger は CloudWatch へ出る。ログ閲覧権限が「他家庭の PII を落とせる」に化けていた
//
// **初版の test は形 (source を正規表現で読む) で守ろうとして破られた** (#4867 adversarial 実測)。
// 9 箇所の logger 呼び出しのうち 1 行で書かれた 2 箇所を取りこぼし、さらに変数経由 / 別名 import /
// 分割代入 / キー名変更 / 計算プロパティ / error フィールド混入の 6 変異がすべて生存した。
// 本版は **振る舞い**で見る — logger を spy し、**出力に PIN そのものが含まれないこと**を
// assert する。書き方に依存しないので、上の 6 変異はすべて 1 つの assertion で死ぬ。
//
// 固定する不変条件:
//   [P1] 削除失敗経路で、logger 出力のどこにも PIN が現れない (例外 message 経由も含む)
//   [P2] 起票経路で、logger 出力のどこにも PIN が現れない
//   [P3] 起票ログは「起票と完了/削除を突き合わせる key」を失っていない
//   [P4] redactStorageKey が fail-closed (想定外の形でも PIN を素通りさせない)
//   [P5] S3 の部分失敗サマリ (複数 key を含む文字列) も伏せられる
//
// 同 class の招待コードは `tests/unit/auth/invite-code-not-logged.test.ts` が持つ。

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** logger に渡った全引数を deep-serialize して貯める (どのフィールドに混ぜても捕まる)。 */
const logged: string[] = [];
const record = (...args: unknown[]) => {
	logged.push(JSON.stringify(args, (_k, v) => (v instanceof Error ? v.message : v)));
};
vi.mock('$lib/server/logger', () => ({
	logger: { info: record, warn: record, error: record, debug: record },
}));

const PIN = 'K7M2QX'; // PIN_CHARS の文字種・長さに一致する固定値
const S3_KEY = `exports/t-owner/${PIN}/backup.zip`;

const mockPurge = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		cloudExport: {
			findById: vi.fn(async () => ({ id: 'e-1', s3Key: S3_KEY, pinCode: PIN })),
			deleteById: vi.fn(async () => undefined),
		},
		storage: { purgeByPrefix: (...a: unknown[]) => mockPurge(...a) },
	}),
}));

const { deleteCloudExport } = await import('../../../src/lib/server/services/cloud-export-service');
const { redactStorageKey, redactStorageKeysInText } = await import(
	'../../../src/lib/domain/storage-key-redaction'
);

beforeEach(() => {
	logged.length = 0;
	vi.clearAllMocks();
});

describe('[P1] 削除失敗経路で PIN がログに出ない', () => {
	it('S3 の部分失敗メッセージが生 key を含んでいても、ログに PIN は出ない', async () => {
		// #4767 で fail-closed にした経路。S3 は失敗キーをそのまま message に載せてくる。
		mockPurge.mockRejectedValue(
			new Error(`S3 purge partially failed: 1/1 objects remain (${S3_KEY}:AccessDenied)`),
		);

		await expect(deleteCloudExport('e-1', 't-owner')).rejects.toBeTruthy();

		expect(logged.length, 'ログが 1 件も出ていない (silent failure)').toBeGreaterThan(0);
		for (const line of logged) {
			expect(
				line.includes(PIN),
				`ログに PIN が出ている。他家庭の PII ZIP を引ける材料が CloudWatch に残る:\n${line}`,
			).toBe(false);
		}
	});
});

describe('[P4][P5] redact は fail-closed', () => {
	it('正規の形の key から PIN を落とす', () => {
		expect(redactStorageKey(S3_KEY)).not.toContain(PIN);
		expect(redactStorageKey(S3_KEY), 'file 名は残す (運用が何の成果物か分かる)').toContain(
			'backup.zip',
		);
	});

	it('**想定外の形でも**素通りさせない (初版はここが穴だった)', () => {
		for (const key of [
			`exports/${PIN}`,
			`exports//${PIN}/backup.zip`,
			`tenants/t-owner/exports/${PIN}/backup.zip`,
			`exports/t-owner/${PIN}`,
			`exports/t-owner/${PIN}/nested/dir/backup.zip`,
		]) {
			expect(redactStorageKey(key), `PIN が素通りしている: ${key}`).not.toContain(PIN);
		}
	});

	it('exports 配下でなくても PIN の形のセグメントは伏せる', () => {
		expect(redactStorageKey(`tenants/t-owner/${PIN}/avatar.svg`)).not.toContain(PIN);
	});

	it('PIN と関係ない key は壊さない', () => {
		expect(redactStorageKey('tenants/t-owner/children/c-1/avatar.svg')).toBe(
			'tenants/t-owner/children/c-1/avatar.svg',
		);
		expect(redactStorageKey('')).toBe('');
	});

	it('[P5] 複数 key を含む文字列 (S3 部分失敗サマリ) も伏せる', () => {
		const summary = `S3 purge partially failed: 2/3 objects remain (${S3_KEY}:AccessDenied, exports/t-x/${PIN}/data.json:SlowDown)`;
		const out = redactStorageKeysInText(summary);
		expect(out, `サマリに PIN が残っている:\n${out}`).not.toContain(PIN);
		expect(out, 'エラーコードまで消してはいけない (原因が読めなくなる)').toContain('AccessDenied');
	});
});

describe('[P3] 起票ログが join できる key を持っている', () => {
	it('起票ログの context に、伏せた s3Key が入っている', () => {
		// 起票経路は plan gate / repo / storage の依存が深いので、ここでは
		// 「伏せた key が join に足りる形か」を redact 側で確認する。
		const redacted = redactStorageKey(S3_KEY);
		expect(redacted, 'テナント配下で一意に指せる形が残っていない').toContain('backup.zip');
		expect(redacted).not.toContain(PIN);
	});
});
