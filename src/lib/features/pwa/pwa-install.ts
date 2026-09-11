// #4644: 「ホーム画面に追加」(PWA インストール) 促進 UX の純ロジック。
//
// component から切り出しているのは、判定 (どの環境で何を出すか / 一度閉じたら二度と出さない)
// が実害に直結する部分だからである。ADR-0012 (anti-engagement) の要求は「閉じたら二度と
// 出さない」であり、これを component の中の暗黙の分岐に埋めると回帰が検出できない。

/**
 * バナーを閉じた / インストール済みを記録する localStorage キー。
 *
 * 端末ごとの判断なので localStorage で正しい (同じ家庭でも「親のスマホには追加したが
 * リビングのタブレットにはまだ」が普通に起きる。サーバ側 tenant 設定にしてはならない)。
 */
export const PWA_INSTALL_DISMISSED_KEY = 'ganbari-quest:pwa-install-dismissed';

/** 追加手順の出し分け対象プラットフォーム。 */
export type PwaInstallPlatform = 'android' | 'ios' | 'other';

/**
 * User-Agent から手順の出し分け先を決める。
 *
 * UA 判定は本来避けたいが、iOS Safari は `beforeinstallprompt` を実装しておらず
 * 「プログラムから追加ダイアログを出す」手段が存在しない。iOS だけは手順書を見せるしか
 * ないため、ここでの分岐は機能検出で代替できない (機能検出できるのは Android/Chrome 側)。
 */
export function detectPwaPlatform(userAgent: string): PwaInstallPlatform {
	const ua = userAgent.toLowerCase();
	// iPadOS 13+ は既定で Macintosh を名乗るため、touch 端末かどうかは呼び出し側が補う。
	if (/iphone|ipad|ipod/.test(ua)) return 'ios';
	if (/android/.test(ua)) return 'android';
	return 'other';
}

/**
 * 既に standalone (ホーム画面から起動) で開かれているか。
 *
 * true のときは案内を出す理由が無い (もう追加済み)。`navigator.standalone` は iOS Safari
 * 専用の非標準プロパティで、iOS では `display-mode: standalone` の media query が
 * 効かない期間が長かったため両方を見る。
 */
export function isStandaloneDisplay(win: Window | undefined): boolean {
	if (!win) return false;
	const iosStandalone = (win.navigator as Navigator & { standalone?: boolean }).standalone;
	if (iosStandalone === true) return true;
	return win.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** 案内を閉じた端末か (= 二度と出さない)。 */
export function isPwaBannerDismissed(storage: Storage | undefined): boolean {
	if (!storage) return false;
	try {
		return storage.getItem(PWA_INSTALL_DISMISSED_KEY) !== null;
	} catch {
		// Safari のプライベートブラウズ等で getItem が例外を投げる環境がある。
		// 読めない = 判定できないので「出さない」側に倒す (押し付けないことを優先)。
		return true;
	}
}

/** 案内を閉じたことを記録する。 */
export function dismissPwaBanner(storage: Storage | undefined): void {
	if (!storage) return;
	try {
		storage.setItem(PWA_INSTALL_DISMISSED_KEY, '1');
	} catch {
		// 保存できない環境では次回も出てしまうが、例外で操作自体を壊さない。
	}
}

/**
 * `beforeinstallprompt` イベント (Chromium 系のみ)。TS の DOM lib に型が無い。
 */
export interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * 案内バナーを出してよいか。
 *
 * - 既に standalone → 不要
 * - 一度閉じた端末 → ADR-0012 により二度と出さない
 * - 手順も出せず native ダイアログも出せない環境 (デスクトップ Firefox 等) → 出さない
 *   (「追加できます」と言っておいて追加方法が無いのは案内として成立しない)
 */
export function shouldShowInstallBanner(input: {
	standalone: boolean;
	dismissed: boolean;
	platform: PwaInstallPlatform;
	hasNativePrompt: boolean;
}): boolean {
	if (input.standalone) return false;
	if (input.dismissed) return false;
	if (input.hasNativePrompt) return true;
	return input.platform === 'ios' || input.platform === 'android';
}
