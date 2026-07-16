// tests/unit/routes/receipt-note-runtime-limit.test.ts
// #3775 ②: 領収書撮影ボタンの note が「実効の受理上限」と一致することを保証する。
//
// 旧実装は静的 note「JPEG, PNG, WebP（5MB以下）」だったが、aws-prod では base64 JSON body が
// Function URL 6MB request cap を超えないよう OCR route が ~4.1MB (実効値) で reject する。
// 「5MB と書いてあるのに 4.5MB が弾かれる」UX 齟齬を防ぐため、note の表示 MB は
// server が実際に reject する閾値 (resolveMaxBase64DecodedBytes → toDisplayMb) と一致させる。

import { afterEach, describe, expect, it } from 'vitest';
import { POINTS_LABELS } from '../../../src/lib/domain/labels';
import { resetEnvForTesting } from '../../../src/lib/runtime/env';
import { resolveMaxBase64DecodedBytes } from '../../../src/lib/server/services/function-url-limit';
import { toDisplayMb } from '../../../src/lib/server/services/import-limit';
import { RECEIPT_MAX_IMAGE_BYTES } from '../../../src/lib/server/services/receipt-ocr-service';

const originalFnName = process.env.AWS_LAMBDA_FUNCTION_NAME;

function setMode(awsMode: boolean) {
	if (awsMode) process.env.AWS_LAMBDA_FUNCTION_NAME = 'ganbari-quest-app';
	else delete process.env.AWS_LAMBDA_FUNCTION_NAME;
	resetEnvForTesting();
}

afterEach(() => {
	if (originalFnName === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
	else process.env.AWS_LAMBDA_FUNCTION_NAME = originalFnName;
	resetEnvForTesting();
});

describe('#3775 ② 領収書 note は実効受理上限と一致する', () => {
	it('receiptCaptureButtonNote は maxMb を受ける関数で、画像形式と MB 表記を含む', () => {
		const note = POINTS_LABELS.receiptCaptureButtonNote('4.1');
		expect(typeof POINTS_LABELS.receiptCaptureButtonNote).toBe('function');
		expect(note).toContain('JPEG');
		expect(note).toContain('4.1MB');
	});

	it('aws-prod: note の MB = OCR route の実効 reject 閾値 (~4.1MB、静的 5MB ではない)', () => {
		setMode(true);
		const effectiveMb = toDisplayMb(resolveMaxBase64DecodedBytes(RECEIPT_MAX_IMAGE_BYTES));
		expect(effectiveMb).toBeLessThan(5);
		expect(effectiveMb).toBeCloseTo(4.1, 1);
		// note が実効値を反映していること (5MB 固定でないこと)
		expect(POINTS_LABELS.receiptCaptureButtonNote(String(effectiveMb))).toContain(
			`${effectiveMb}MB`,
		);
	});

	it('local / NUC: Function URL 制約なし — 実効上限は 5MB のまま', () => {
		setMode(false);
		const effectiveMb = toDisplayMb(resolveMaxBase64DecodedBytes(RECEIPT_MAX_IMAGE_BYTES));
		expect(effectiveMb).toBe(5);
	});
});
