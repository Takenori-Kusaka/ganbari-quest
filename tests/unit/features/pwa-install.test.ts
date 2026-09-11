// tests/unit/features/pwa-install.test.ts
// #4644: 「ホーム画面に追加」案内の表示判定。
//
// ADR-0012 (anti-engagement) の要求は「一度閉じたら二度と出さない」であり、これが壊れると
// 親が admin を開くたびに案内が出続ける = 押し付けになる。判定を component の分岐に埋めず
// 純関数に切り出しているのはこの回帰を機械検出するため。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	detectPwaPlatform,
	dismissPwaBanner,
	isPwaBannerDismissed,
	isStandaloneDisplay,
	PWA_INSTALL_DISMISSED_KEY,
	shouldShowInstallBanner,
} from '../../../src/lib/features/pwa/pwa-install';

/** localStorage の最小 stub (例外を投げる版も作れるようにする)。 */
function createStorage(options: { throwOnGet?: boolean; throwOnSet?: boolean } = {}): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => {
			if (options.throwOnGet) throw new Error('access denied');
			return map.get(k) ?? null;
		},
		setItem: (k: string, v: string) => {
			if (options.throwOnSet) throw new Error('quota exceeded');
			map.set(k, v);
		},
		removeItem: (k: string) => {
			map.delete(k);
		},
		clear: () => map.clear(),
		key: () => null,
		get length() {
			return map.size;
		},
	} as Storage;
}

describe('detectPwaPlatform', () => {
	it.each([
		['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1', 'ios'],
		['iPad Safari', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/605.1', 'ios'],
		['Android Chrome', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0', 'android'],
		['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0', 'other'],
	])('%s → %s', (_name, ua, expected) => {
		expect(detectPwaPlatform(ua)).toBe(expected);
	});
});

describe('isStandaloneDisplay', () => {
	it('iOS の navigator.standalone が true なら standalone', () => {
		const win = { navigator: { standalone: true }, matchMedia: () => ({ matches: false }) };
		expect(isStandaloneDisplay(win as unknown as Window)).toBe(true);
	});

	it('display-mode: standalone にマッチすれば standalone', () => {
		const win = { navigator: {}, matchMedia: () => ({ matches: true }) };
		expect(isStandaloneDisplay(win as unknown as Window)).toBe(true);
	});

	it('どちらでもなければ browser タブ扱い', () => {
		const win = { navigator: {}, matchMedia: () => ({ matches: false }) };
		expect(isStandaloneDisplay(win as unknown as Window)).toBe(false);
	});
});

describe('案内を閉じた記録 (端末ごと)', () => {
	let storage: Storage;

	beforeEach(() => {
		storage = createStorage();
	});

	it('閉じる前は未 dismiss', () => {
		expect(isPwaBannerDismissed(storage)).toBe(false);
	});

	it('閉じたら dismiss として記録される', () => {
		dismissPwaBanner(storage);
		expect(storage.getItem(PWA_INSTALL_DISMISSED_KEY)).not.toBeNull();
		expect(isPwaBannerDismissed(storage)).toBe(true);
	});

	it('localStorage が読めない環境では「出さない」側に倒す', () => {
		expect(isPwaBannerDismissed(createStorage({ throwOnGet: true }))).toBe(true);
	});

	it('localStorage に書けなくても例外を投げない (操作自体を壊さない)', () => {
		expect(() => dismissPwaBanner(createStorage({ throwOnSet: true }))).not.toThrow();
	});
});

describe('shouldShowInstallBanner', () => {
	const base = {
		standalone: false,
		dismissed: false,
		platform: 'android' as const,
		hasNativePrompt: true,
	};

	it('通常の Android (native prompt あり) では出す', () => {
		expect(shouldShowInstallBanner(base)).toBe(true);
	});

	it('iOS Safari は native prompt が無くても手順を出せるので出す', () => {
		expect(shouldShowInstallBanner({ ...base, platform: 'ios', hasNativePrompt: false })).toBe(
			true,
		);
	});

	it('デスクトップで native prompt も無い環境では出さない (追加方法を示せないため)', () => {
		expect(shouldShowInstallBanner({ ...base, platform: 'other', hasNativePrompt: false })).toBe(
			false,
		);
	});

	it('すでに standalone 起動なら出さない', () => {
		expect(shouldShowInstallBanner({ ...base, standalone: true })).toBe(false);
	});

	it('一度閉じた端末には二度と出さない (ADR-0012)', () => {
		expect(shouldShowInstallBanner({ ...base, dismissed: true })).toBe(false);
	});

	it('閉じた記録は standalone / native prompt の有無より優先される', () => {
		// 「native prompt が来たから」を理由に再表示してしまう回帰を塞ぐ。
		expect(shouldShowInstallBanner({ ...base, dismissed: true, hasNativePrompt: true })).toBe(
			false,
		);
	});
});

describe('dismiss キーの安定性', () => {
	it('キー名を変えると既存ユーザーに案内が再表示されるため固定する', () => {
		// 値そのものを assert するのは「うっかり rename したら気づく」ためであり、
		// rename が必要なら移行 (旧キーの読み替え) を同時に入れること。
		expect(PWA_INSTALL_DISMISSED_KEY).toBe('ganbari-quest:pwa-install-dismissed');
	});
});

describe('storage 未提供時', () => {
	it('SSR (storage undefined) では dismiss 判定を false にして描画を壊さない', () => {
		expect(isPwaBannerDismissed(undefined)).toBe(false);
		expect(() => dismissPwaBanner(undefined)).not.toThrow();
	});

	it('window 未提供 (SSR) では standalone 判定を false にする', () => {
		expect(isStandaloneDisplay(undefined)).toBe(false);
	});
});

describe('非トートロジー証明', () => {
	it('stub の setItem が実際に呼ばれている', () => {
		const storage = createStorage();
		const spy = vi.spyOn(storage, 'setItem');
		dismissPwaBanner(storage);
		expect(spy).toHaveBeenCalledWith(PWA_INSTALL_DISMISSED_KEY, '1');
	});
});
