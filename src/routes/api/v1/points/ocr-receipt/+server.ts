import { json } from '@sveltejs/kit';
import {
	RECEIPT_OCR_QUOTA_PER_TENANT,
	RECEIPT_OCR_QUOTA_WINDOW_MS,
} from '$lib/domain/constants/receipt-ocr-quota';
import { POINTS_LABELS } from '$lib/domain/labels';
import { resolveAiUnavailableMessage } from '$lib/server/ai/unavailable-message';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { apiError, validationError } from '$lib/server/errors';
import { validateBase64ImageMagicBytes } from '$lib/server/security/magic-bytes';
import { checkRateLimit } from '$lib/server/security/rate-limiter';
import { resolveMaxBase64DecodedBytes } from '$lib/server/services/function-url-limit';
import { toDisplayMb } from '$lib/server/services/import-limit';
import { ocrReceipt, RECEIPT_MAX_IMAGE_BYTES } from '$lib/server/services/receipt-ocr-service';
import type { RequestHandler } from './$types';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	// #4866 系 QM 監査 (security) / PO 差し戻し 2026-09-09:
	// `ROUTE_RULES` は `/api/v1` を `['owner','parent','child']` に開けているので、
	// **child セッションからこの経路に到達できた**。呼び出し元は `/admin/points` の
	// 1 箇所だけ (親画面) で、扱うのは**氏名・住所が写り込む領収書画像**、そして
	// OCR は**顧客の金 (ベンダーコスト)** を動かす。親限定であることに判断の余地は無い。
	//
	// **body を読む前**に倒す — 権限の無い要求のために画像を受け取らない。
	// role 判定はルート横断の唯一の seam 経由 (#3528 / 14-セキュリティ設計書 §5.2.3 §5.2.5)。
	//
	// per-tenant quota (回数上限) は上限値が製品判断なので PO 決裁票に上げてある。
	const roleGate = parentGateResponse(locals);
	if (roleGate) return roleGate;

	const body = await request.json();
	const { image, mimeType } = body as { image?: string; mimeType?: string };

	if (!image || !mimeType) {
		return validationError('画像データが不足しています');
	}

	if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
		return validationError('対応していない画像形式です。JPEG、PNG、WebPをお使いください。');
	}

	// base64サイズチェック（base64は元データの約1.33倍）。
	// #3694: AWS 本番は base64 JSON body が Function URL 6MB request cap を超えると edge で
	// 沈黙拒否されるため、デコード後上限を runtime 実効値に下方整合する (NUC / local は 5MB 維持)。
	const maxImageBytes = resolveMaxBase64DecodedBytes(RECEIPT_MAX_IMAGE_BYTES);
	const estimatedSize = (image.length * 3) / 4;
	if (estimatedSize > maxImageBytes) {
		return validationError(POINTS_LABELS.receiptImageTooLarge(String(toDisplayMb(maxImageBytes))));
	}

	// マジックバイト検証（Content-Type偽装対策）
	const magicCheck = validateBase64ImageMagicBytes(image, mimeType);
	if (!magicCheck.valid) {
		return validationError('ファイルの内容が宣言された形式と一致しません');
	}

	// 1 世帯あたりの回数上限 (PO 決裁 2026-09-10 決定 5)。
	//
	// **検証をすべて通ったあと、実際にベンダーを呼ぶ直前に数える。** 手前に置くと、
	// 形式違い / サイズ超過で弾かれた要求まで顧客の残り回数を減らしてしまう
	// (顧客はコストを発生させていないのに枠を失う)。
	//
	// **既存の `checkRateLimit` をそのまま使う (新しい装置を作らない、PO 決定 5)。**
	// 制約もそのまま引き継ぐ: 実体は Lambda プロセス内の in-memory Map なので、
	// **プロセスが入れ替われば数え直しになる**。厳密な 1 日 20 回の保証ではなく、
	// 連打・誤操作でベンダーコストが青天井になるのを止めるための線として置いている。
	const quota = checkRateLimit(
		`ocr-receipt:${context.tenantId}`,
		RECEIPT_OCR_QUOTA_PER_TENANT,
		RECEIPT_OCR_QUOTA_WINDOW_MS,
	);
	if (!quota.allowed) {
		// アップグレード導線は出さない (PO 決定 5)。`DAILY_LIMIT_REACHED` は
		// severity=info / action=none で、顧客が今できることが無い状況にそのまま合う。
		return apiError('DAILY_LIMIT_REACHED', POINTS_LABELS.receiptQuotaExceeded, {
			tenantId: context.tenantId,
			resetAt: new Date(quota.resetAt).toISOString(),
		});
	}

	const result = await ocrReceipt(image, mimeType);

	if ('error' in result) {
		// AI 側の事情 (未設定 / 権限なし / キー不正) は 503 + 手入力導線。画像起因の失敗 (422) と
		// 混ぜると顧客が撮り直しを繰り返す (#4366)。
		// 文言は配備で変わる — セルフホスト家庭に「運営が検知済み」は嘘になるため
		// (`$lib/server/ai/unavailable-message` が実行モードから選ぶ)。
		if (result.error === 'AI_UNAVAILABLE') {
			return json(
				{
					error: {
						code: 'AI_UNAVAILABLE',
						message: resolveAiUnavailableMessage(),
					},
				},
				{ status: 503 },
			);
		}
		return json({ error: { code: 'OCR_FAILED', message: result.message } }, { status: 422 });
	}

	return json(result);
};
