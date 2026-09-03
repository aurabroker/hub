import qrcode from 'qrcode-generator';

/**
 * Kody QR do materiałów drukowanych. Generujemy własny SVG zamiast używać
 * createSvgTag z biblioteki — potrzebujemy kontroli nad marginesem ciszy,
 * kolorami i skalowaniem przez viewBox, żeby kod nadawał się do druku
 * w dowolnym rozmiarze.
 */

export type QrOptions = {
	/** Margines ciszy w modułach. Norma ISO wymaga co najmniej 4. */
	quietZone?: number;
	dark?: string;
	light?: string;
	/** Rozmiar w pikselach dla atrybutów width/height. */
	size?: number;
};

/**
 * Buduje SVG kodu QR. Poziom korekcji M daje ~15% odporności na uszkodzenia,
 * co jest standardem dla kodów drukowanych. Typ 0 oznacza automatyczny dobór
 * wersji do długości danych.
 */
export function qrSvg(text: string, options: QrOptions = {}): string {
	const quiet = options.quietZone ?? 4;
	const dark = options.dark ?? '#000000';
	const light = options.light ?? '#ffffff';
	const size = options.size ?? 512;

	const qr = qrcode(0, 'M');
	qr.addData(text);
	qr.make();

	const count = qr.getModuleCount();
	const span = count + quiet * 2;

	// Każdy rząd składamy w poziome odcinki — mniej ścieżek niż prostokąt na moduł,
	// więc plik jest wielokrotnie mniejszy i szybciej się renderuje.
	const parts: string[] = [];
	for (let row = 0; row < count; row++) {
		let runStart = -1;
		for (let col = 0; col <= count; col++) {
			const on = col < count && qr.isDark(row, col);
			if (on && runStart < 0) runStart = col;
			if (!on && runStart >= 0) {
				parts.push(`M${runStart + quiet} ${row + quiet}h${col - runStart}v1h-${col - runStart}z`);
				runStart = -1;
			}
		}
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
		`viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img" ` +
		`aria-label="Kod QR">` +
		`<rect width="${span}" height="${span}" fill="${light}"/>` +
		`<path d="${parts.join('')}" fill="${dark}"/>` +
		`</svg>`
	);
}
