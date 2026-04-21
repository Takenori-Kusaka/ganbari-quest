// tests/unit/routes/consent-page-title.test.ts
// #1355: /consent の <title> タグが hasExistingConsent 分岐に対応していることを検証

import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} }),
}));

import ConsentPage from '../../../src/routes/consent/+page.svelte';

function makeData(hasExistingConsent: boolean) {
	return {
		role: null,
		requestId: 'test-request-id',
		isDemo: false,
		hasExistingConsent,
		termsAccepted: !hasExistingConsent,
		privacyAccepted: !hasExistingConsent,
		currentTermsVersion: '2026-04-01',
		currentPrivacyVersion: '2026-04-01',
		previousTermsVersion: hasExistingConsent ? '2025-01-01' : null,
		previousPrivacyVersion: hasExistingConsent ? '2025-01-01' : null,
	};
}

describe('/consent <title> 分岐 (#1355)', () => {
	afterEach(() => {
		cleanup();
	});

	it('hasExistingConsent=false のとき「規約への同意 - がんばりクエスト」', () => {
		render(ConsentPage, { data: makeData(false), form: null });
		expect(document.title).toBe('規約への同意 - がんばりクエスト');
	});

	it('hasExistingConsent=true のとき「規約に変更がありました - がんばりクエスト」', () => {
		render(ConsentPage, { data: makeData(true), form: null });
		expect(document.title).toBe('規約に変更がありました - がんばりクエスト');
	});
});
