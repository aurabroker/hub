import { describe, expect, it } from 'vitest';
import { SEARCH_TERMS_VISIBLE, buildKeywords, buildSearchTerms } from './view';

describe('buildKeywords', () => {
	it('dzieli po wyświetleniach; null, brak i tekst nieliczbowy to zero', () => {
		const r = buildKeywords([
			{ keyword: 'a', ad_group: 'G', impressions: 5, cost: 1 },
			{ keyword: 'b', ad_group: 'G', impressions: null },
			{ keyword: 'c', ad_group: 'G' },
			{ keyword: 'd', ad_group: 'G', impressions: 'abc' },
			{ keyword: 'e', ad_group: 'G', impressions: '7' }
		]);
		expect(r.total).toBe(5);
		expect(r.active.map((k) => k.keyword)).toEqual(['a', 'e']);
		expect(r.inactive.map((k) => k.keyword)).toEqual(['b', 'c', 'd']);
	});

	it('aktywne: koszt, kliknięcia, wyświetlenia malejąco, potem słowo rosnąco', () => {
		const r = buildKeywords([
			{ keyword: 'zz', impressions: 1, clicks: 1, cost: 1 },
			{ keyword: 'ąb', impressions: 1, clicks: 1, cost: 1 },
			{ keyword: 'ab', impressions: 1, clicks: 1, cost: 1 },
			{ keyword: 'more-imp', impressions: 9, clicks: 1, cost: 1 },
			{ keyword: 'more-clicks', impressions: 1, clicks: 4, cost: 1 },
			{ keyword: 'top', impressions: 1, clicks: 0, cost: 100 },
			{ keyword: 'free', impressions: 100, clicks: null, cost: null }
		]);
		// Polskie ą po a, nie na końcu alfabetu.
		expect(r.active.map((k) => k.keyword)).toEqual([
			'top',
			'more-clicks',
			'more-imp',
			'ab',
			'ąb',
			'zz',
			'free'
		]);
	});

	it('nieaktywne: po grupie reklam, potem po słowie', () => {
		const r = buildKeywords([
			{ keyword: 'b', ad_group: 'B' },
			{ keyword: 'z', ad_group: 'A' },
			{ keyword: 'a', ad_group: 'B' },
			{ keyword: 'y', ad_group: 'A' }
		]);
		expect(r.inactive.map((k) => `${k.adGroup}/${k.keyword}`)).toEqual(['A/y', 'A/z', 'B/a', 'B/b']);
	});

	it('pełny remis zostawia kolejność ze skryptu', () => {
		const r = buildKeywords([
			{ keyword: 'x', ad_group: 'pierwszy', impressions: 1 },
			{ keyword: 'x', ad_group: 'drugi', impressions: 1 }
		]);
		expect(r.active.map((k) => k.adGroup)).toEqual(['pierwszy', 'drugi']);
	});

	it('brak tablicy i śmieci w tablicy nie wywracają', () => {
		expect(buildKeywords(undefined)).toEqual({ total: 0, active: [], inactive: [] });
		expect(buildKeywords([null, 1, 'x']).total).toBe(0);
	});
});

describe('buildSearchTerms', () => {
	it(`dzieli na pierwsze ${SEARCH_TERMS_VISIBLE} i resztę`, () => {
		const input = Array.from({ length: SEARCH_TERMS_VISIBLE + 1 }, (_, i) => ({
			search_term: `t${i}`,
			impressions: 1,
			cost: i
		}));
		const r = buildSearchTerms(input);
		expect(r.total).toBe(SEARCH_TERMS_VISIBLE + 1);
		expect(r.top).toHaveLength(SEARCH_TERMS_VISIBLE);
		expect(r.top[0].term).toBe(`t${SEARCH_TERMS_VISIBLE}`);
		expect(r.rest.map((t) => t.term)).toEqual(['t0']);
	});

	it(`dokładnie ${SEARCH_TERMS_VISIBLE}: bez reszty`, () => {
		const input = Array.from({ length: SEARCH_TERMS_VISIBLE }, (_, i) => ({ search_term: `t${i}` }));
		expect(buildSearchTerms(input).rest).toEqual([]);
	});
});
