import { error } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import { qrSvg } from '$lib/server/qr';
import { shortLinkBase } from '$lib/server/utm';
import { shortLinkUrl } from '$lib/utm';
import type { RequestHandler } from './$types';

/**
 * Kod QR linku jako SVG — format wektorowy, więc nadaje się do druku
 * w dowolnym rozmiarze bez utraty jakości. Trasa jest pod bramką admina
 * (nie ma jej w PUBLIC_PREFIXES).
 *
 * ?cel=krotki  → kod prowadzi przez nasze /l/{slug}, kliknięcia lądują w utm_clicks
 * ?cel=pelny   → kod prowadzi prosto na adres docelowy z parametrami UTM
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const db = adminClient();
	const { data: link } = await db
		.from('utm_links')
		.select('slug, label, final_url')
		.eq('id', params.id)
		.maybeSingle();
	if (!link) error(404, 'Nie znaleziono linku');

	const target =
		url.searchParams.get('cel') === 'pelny'
			? (link.final_url as string)
			: shortLinkUrl(shortLinkBase(url.origin), link.slug as string);

	const size = Math.min(Math.max(Number.parseInt(url.searchParams.get('px') ?? '512', 10) || 512, 128), 2048);
	const svg = qrSvg(target, { size });

	const filename = `qr-${link.slug}.svg`;
	return new Response(svg, {
		headers: {
			'content-type': 'image/svg+xml; charset=utf-8',
			'cache-control': 'private, max-age=300',
			...(url.searchParams.get('pobierz') === '1'
				? { 'content-disposition': `attachment; filename="${filename}"` }
				: {})
		}
	});
};
