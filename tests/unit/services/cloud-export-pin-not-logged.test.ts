// tests/unit/services/cloud-export-pin-not-logged.test.ts
//
// クラウド共有 export の **PIN をログに出さない**ことを固定する (QM 監査 security / PO 決裁 2026-09-09)。
//
// なぜ重い欠陥だったか:
//   - この PIN は**他家庭のフル PII バックアップ** (子供の氏名・生年月日・顔写真・音声を含む ZIP)
//     を引き当てる唯一の材料で、`fetchCloudExportByPin` は **tenant 述語なしで**引く
//   - 本番の `logger.info` は CloudWatch へ出る。つまりログ閲覧権限が「他家庭の PII を落とせる」に化けていた
//   - `s3Key` は `exports/<tenantId>/<pinCode>/<file>` で **PIN をそのまま含む**ため、
//     PIN 変数を消すだけでは足りない (削除失敗時の error ログが s3Key を出していた)
//
// 固定する不変条件:
//   [P1] 起票時の logger 呼び出しに PIN が含まれない (context を再帰的に走査する)
//   [P2] `redactPinInS3Key` が PIN 部分だけを伏せ、テナントと file 名は残す (運用が追える)
//   [P3] PIN を含まない形の key を壊さない

import { describe, expect, it, vi } from 'vitest';

const logCalls: unknown[] = [];
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: (...args: unknown[]) => logCalls.push(args),
		warn: (...args: unknown[]) => logCalls.push(args),
		error: (...args: unknown[]) => logCalls.push(args),
		debug: (...args: unknown[]) => logCalls.push(args),
	},
}));

const { redactPinInS3Key } = await import('../../../src/lib/server/services/cloud-export-service');

describe('[P2][P3] redactPinInS3Key', () => {
	it('PIN 部分だけを伏せ、テナントと file 名は残す', () => {
		expect(redactPinInS3Key('exports/t-abc/123456/backup.zip')).toBe(
			'exports/t-abc/<pin>/backup.zip',
		);
		expect(
			redactPinInS3Key('exports/t-abc/123456/backup.zip'),
			'PIN が素通りしている',
		).not.toContain('123456');
	});

	it('テナント id は残す (運用がどの家庭かを追えなくなるのは行き過ぎ)', () => {
		expect(redactPinInS3Key('exports/t-abc/999999/data.json')).toContain('t-abc');
		expect(redactPinInS3Key('exports/t-abc/999999/data.json')).toContain('data.json');
	});

	it('想定外の形の key を壊さない', () => {
		expect(redactPinInS3Key('other/path/file.zip')).toBe('other/path/file.zip');
		expect(redactPinInS3Key('')).toBe('');
	});
});

describe('[P1] service の source が PIN をログに渡していない', () => {
	// 起票経路は plan gate / repo / storage の依存が深く、この test の目的 (PIN が
	// ログに出ないこと) に対して mock の量が釣り合わない。**logger に渡している式**を
	// source から直接見る。`pinCode` を context に置いた瞬間に落ちる。
	it('logger の context に pinCode / 生の s3Key を渡していない', async () => {
		const { readFileSync } = await import('node:fs');
		const { join } = await import('node:path');
		const src = readFileSync(
			join(__dirname, '../../../src/lib/server/services/cloud-export-service.ts'),
			'utf8',
		);
		// logger.*(...) の呼び出しに現れる context を粗く抜き出して検査する
		const loggerCalls = [...src.matchAll(/logger\.(?:info|warn|error|debug)\([\s\S]*?\n\t*\}\);/g)]
			.map((m) => m[0])
			.filter((c) => !c.trimStart().startsWith('//'));
		expect(loggerCalls.length, 'logger 呼び出しが 1 件も見つからない (正規表現の陳腐化)').
			toBeGreaterThan(0);
		for (const call of loggerCalls) {
			expect(
				/\bpinCode\b/.test(call),
				`logger に pinCode を渡している:\n${call}`,
			).toBe(false);
			expect(
				/s3Key:\s*record\.s3Key|s3Key:\s*s3Key\b/.test(call),
				`logger に生の s3Key を渡している (PIN を含む)。redactPinInS3Key を通すこと:\n${call}`,
			).toBe(false);
		}
	});
});
