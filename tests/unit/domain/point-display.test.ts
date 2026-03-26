import { describe, expect, it } from 'vitest';
import {
	CURRENCY_CODES,
	CURRENCY_DEFS,
	DEFAULT_POINT_SETTINGS,
	formatPointValue,
	formatPointValueWithSign,
	formatWithSettings,
	formatWithSettingsAndSign,
	getUnitLabel,
} from '$lib/domain/point-display';

describe('formatPointValue', () => {
	describe('point mode', () => {
		it('formats integer points with P suffix', () => {
			expect(formatPointValue(100, 'point', 'JPY', 1)).toBe('100P');
		});

		it('formats large numbers with locale separators', () => {
			expect(formatPointValue(1250, 'point', 'JPY', 1)).toBe('1,250P');
		});

		it('formats zero', () => {
			expect(formatPointValue(0, 'point', 'JPY', 1)).toBe('0P');
		});

		it('ignores currency and rate in point mode', () => {
			expect(formatPointValue(50, 'point', 'USD', 0.01)).toBe('50P');
		});
	});

	describe('currency mode - JPY', () => {
		it('formats with 円 suffix (rate=1)', () => {
			expect(formatPointValue(100, 'currency', 'JPY', 1)).toBe('100円');
		});

		it('formats large numbers with separators', () => {
			expect(formatPointValue(1250, 'currency', 'JPY', 1)).toBe('1,250円');
		});

		it('applies rate conversion', () => {
			expect(formatPointValue(100, 'currency', 'JPY', 10)).toBe('1,000円');
		});

		it('rate < 1 truncates to 0 decimals for JPY', () => {
			expect(formatPointValue(100, 'currency', 'JPY', 0.5)).toBe('50円');
		});
	});

	describe('currency mode - USD', () => {
		it('formats with $ prefix and 2 decimals', () => {
			expect(formatPointValue(100, 'currency', 'USD', 1)).toBe('$100.00');
		});

		it('applies rate conversion (1P = $0.01)', () => {
			expect(formatPointValue(100, 'currency', 'USD', 0.01)).toBe('$1.00');
		});

		it('handles fractional values', () => {
			expect(formatPointValue(123, 'currency', 'USD', 0.01)).toBe('$1.23');
		});

		it('formats large numbers with separators', () => {
			expect(formatPointValue(100000, 'currency', 'USD', 0.01)).toBe('$1,000.00');
		});
	});

	describe('currency mode - EUR', () => {
		it('formats with € prefix', () => {
			expect(formatPointValue(50, 'currency', 'EUR', 1)).toBe('€50.00');
		});
	});

	describe('currency mode - GBP', () => {
		it('formats with £ prefix', () => {
			expect(formatPointValue(50, 'currency', 'GBP', 1)).toBe('£50.00');
		});
	});

	describe('currency mode - AUD', () => {
		it('formats with A$ prefix', () => {
			expect(formatPointValue(50, 'currency', 'AUD', 1)).toBe('A$50.00');
		});
	});

	describe('currency mode - CAD', () => {
		it('formats with C$ prefix', () => {
			expect(formatPointValue(50, 'currency', 'CAD', 1)).toBe('C$50.00');
		});
	});

	describe('zero value', () => {
		it('formats zero in JPY', () => {
			expect(formatPointValue(0, 'currency', 'JPY', 1)).toBe('0円');
		});

		it('formats zero in USD', () => {
			expect(formatPointValue(0, 'currency', 'USD', 1)).toBe('$0.00');
		});
	});
});

describe('formatPointValueWithSign', () => {
	describe('point mode', () => {
		it('adds + prefix for positive', () => {
			expect(formatPointValueWithSign(10, 'point', 'JPY', 1)).toBe('+10P');
		});

		it('adds - prefix for negative', () => {
			expect(formatPointValueWithSign(-5, 'point', 'JPY', 1)).toBe('-5P');
		});

		it('formats zero with +', () => {
			expect(formatPointValueWithSign(0, 'point', 'JPY', 1)).toBe('+0P');
		});
	});

	describe('currency mode - JPY', () => {
		it('adds + prefix with 円 suffix', () => {
			expect(formatPointValueWithSign(10, 'currency', 'JPY', 1)).toBe('+10円');
		});

		it('adds - prefix for negative', () => {
			expect(formatPointValueWithSign(-10, 'currency', 'JPY', 1)).toBe('-10円');
		});
	});

	describe('currency mode - USD', () => {
		it('adds + prefix before $ symbol', () => {
			expect(formatPointValueWithSign(5, 'currency', 'USD', 0.01)).toBe('+$0.05');
		});

		it('adds - prefix for negative', () => {
			expect(formatPointValueWithSign(-100, 'currency', 'USD', 0.01)).toBe('-$1.00');
		});
	});
});

describe('getUnitLabel', () => {
	it('returns P for point mode', () => {
		expect(getUnitLabel('point', 'JPY')).toBe('P');
	});

	it('returns currency symbol for currency mode', () => {
		expect(getUnitLabel('currency', 'JPY')).toBe('円');
		expect(getUnitLabel('currency', 'USD')).toBe('$');
		expect(getUnitLabel('currency', 'EUR')).toBe('€');
	});
});

describe('formatWithSettings', () => {
	it('works with default settings', () => {
		expect(formatWithSettings(100, DEFAULT_POINT_SETTINGS)).toBe('100P');
	});

	it('works with currency settings', () => {
		expect(formatWithSettings(100, { mode: 'currency', currency: 'JPY', rate: 1 })).toBe(
			'100円',
		);
	});
});

describe('formatWithSettingsAndSign', () => {
	it('works with default settings', () => {
		expect(formatWithSettingsAndSign(10, DEFAULT_POINT_SETTINGS)).toBe('+10P');
	});

	it('works with currency settings', () => {
		expect(
			formatWithSettingsAndSign(5, { mode: 'currency', currency: 'USD', rate: 0.01 }),
		).toBe('+$0.05');
	});
});

describe('CURRENCY_CODES', () => {
	it('contains all defined currencies', () => {
		expect(CURRENCY_CODES).toEqual(['JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD']);
	});

	it('matches CURRENCY_DEFS keys', () => {
		expect(CURRENCY_CODES).toEqual(Object.keys(CURRENCY_DEFS));
	});
});
