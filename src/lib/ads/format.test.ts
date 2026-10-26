import { describe, expect, it } from 'vitest';
import {
	DASH,
	MINUS,
	NBSP,
	formatChangePct,
	formatCount,
	formatDate,
	formatInt,
	formatLocalDateTime,
	formatMoney,
	formatPercent,
	formatPeriod,
	formatPp,
	formatWarsawDateTime,
	formatYesNo,
	isIsoDate,
	shiftIsoDate
} from './format';

describe('formatMoney', () => {
	it('grupuje tysiące także w liczbach czterocyfrowych (Intl pl-PL tego nie robi)', () => {
		expect(formatMoney(1234.56)).toBe(`1${NBSP}234,56${NBSP}zł`);
	});
	it('większe kwoty, zera i zaokrąglenie do groszy', () => {
		expect(formatMoney(1234567.891)).toBe(`1${NBSP}234${NBSP}567,89${NBSP}zł`);
		expect(formatMoney(0)).toBe(`0,00${NBSP}zł`);
		expect(formatMoney(55)).toBe(`55,00${NBSP}zł`);
		expect(formatMoney(999.999)).toBe(`1${NBSP}000,00${NBSP}zł`);
	});
	it('kwota ujemna dostaje minus, a nie łącznik', () => {
		expect(formatMoney(-12.5)).toBe(`${MINUS}12,50${NBSP}zł`);
	});
});

describe('formatInt i formatCount', () => {
	it('liczby całkowite z grupowaniem', () => {
		expect(formatInt(1234)).toBe(`1${NBSP}234`);
		expect(formatInt(999)).toBe('999');
		expect(formatInt(5120.4)).toBe(`5${NBSP}120`);
	});
	it('konwersje: całkowite bez przecinka, ułamkowe bez zbędnych zer', () => {
		expect(formatCount(2)).toBe('2');
		expect(formatCount(1.5)).toBe('1,5');
		expect(formatCount(2.333)).toBe('2,33');
	});
});

describe('formatPercent i zmiany', () => {
	it('ułamek jako procent z jednym miejscem', () => {
		expect(formatPercent(0.0806)).toBe('8,1%');
		expect(formatPercent(0.25)).toBe('25,0%');
		expect(formatPercent(0)).toBe('0,0%');
	});
	it('zmiana względna ze znakiem', () => {
		expect(formatChangePct(0.123)).toBe('+12,3%');
		expect(formatChangePct(-0.32)).toBe(`${MINUS}32,0%`);
		expect(formatChangePct(0.00001)).toBe('0,0%');
	});
	it('zmiana w punktach procentowych', () => {
		expect(formatPp(0.08)).toBe(`+8,0${NBSP}pp`);
		expect(formatPp(-0.05)).toBe(`${MINUS}5,0${NBSP}pp`);
	});
});

describe('daty', () => {
	it('DD.MM.RRRR bez przesunięcia strefy', () => {
		expect(formatDate('2026-11-01')).toBe('01.11.2026');
		expect(formatPeriod('2026-10-26', '2026-11-01')).toBe(`26.10.2026 ${DASH} 01.11.2026`);
	});
	it('rozpoznaje daty niemożliwe', () => {
		expect(isIsoDate('2026-02-30')).toBe(false);
		expect(isIsoDate('2026-13-01')).toBe(false);
		expect(isIsoDate('2026-11-1')).toBe(false);
		expect(isIsoDate('2028-02-29')).toBe(true);
		expect(formatDate('2026-02-30')).toBe(DASH);
	});
	it('przesuwa datę o dni przez granicę miesiąca i zmianę czasu', () => {
		expect(shiftIsoDate('2026-11-01', -6)).toBe('2026-10-26');
		expect(shiftIsoDate('2026-10-25', 1)).toBe('2026-10-26');
	});
	it('chwila ISO w czasie warszawskim (zima i lato)', () => {
		expect(formatWarsawDateTime('2026-11-02T05:03:11.000Z')).toBe('02.11.2026 06:03');
		expect(formatWarsawDateTime('2026-07-01T22:30:00Z')).toBe('02.07.2026 00:30');
	});
	it('data z dziennika zmian bez przeliczania stref', () => {
		expect(formatLocalDateTime('2026-10-27 10:12:33')).toBe('27.10.2026 10:12');
	});
});

describe('brak wartości', () => {
	it('null, undefined, NaN i śmieci to półpauza', () => {
		for (const v of [null, undefined, Number.NaN, Infinity, '', 'abc', {}]) {
			expect(formatMoney(v)).toBe(DASH);
			expect(formatInt(v)).toBe(DASH);
			expect(formatPercent(v)).toBe(DASH);
			expect(formatPp(v)).toBe(DASH);
			expect(formatChangePct(v)).toBe(DASH);
		}
		expect(formatDate(null)).toBe(DASH);
		expect(formatWarsawDateTime(undefined)).toBe(DASH);
		expect(formatYesNo(null)).toBe(DASH);
	});
	it('półpauza to U+2013', () => {
		expect(DASH).toBe('–');
	});
	it('tak / nie', () => {
		expect(formatYesNo(true)).toBe('tak');
		expect(formatYesNo(false)).toBe('nie');
	});
});
