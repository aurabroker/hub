<script lang="ts">
	/**
	 * Wykres wielkości słowa: linia bez osi, bez siatki i bez podpisów.
	 *
	 * Sparkline nie służy do odczytywania wartości — od tego jest liczba obok.
	 * Pokazuje kształt: czy rośnie, czy spada, czy był skok. Dlatego nie ma tu
	 * nic poza linią, delikatnym wypełnieniem i kropką na ostatnim punkcie.
	 *
	 * Rozmiar jest stały w pikselach, a nie płynny. Rozciąganie w jednej osi
	 * zniekształciłoby kropkę w elipsę, a sparkline i tak ma być mały.
	 */
	let {
		data,
		color = 'var(--data-1)',
		width = 132,
		height = 30,
		label = 'Przebieg ostatnich dni'
	}: {
		data: number[];
		color?: string;
		width?: number;
		height?: number;
		label?: string;
	} = $props();

	/** Margines pionowy, żeby linia przy maksimum nie była ucięta przez krawędź. */
	const PAD = 3;
	/** Promień kropki na ostatnim punkcie. */
	const DOT = 2.5;

	let punkty = $derived.by(() => {
		const values = data.filter((v) => Number.isFinite(v));
		if (values.length === 0) return [];

		const min = Math.min(...values);
		const max = Math.max(...values);
		const zakres = max - min;
		const innerH = height - PAD * 2;
		// Przy jednym punkcie albo płaskiej serii rysujemy linię w połowie
		// wysokości. Dzielenie przez zerowy zakres dałoby NaN i pustą ścieżkę.
		const krok = values.length > 1 ? (width - DOT * 2) / (values.length - 1) : 0;

		return values.map((v, i) => ({
			x: DOT + i * krok,
			y: zakres === 0 ? height / 2 : PAD + innerH - ((v - min) / zakres) * innerH
		}));
	});

	let linia = $derived(punkty.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));

	/** Ta sama ścieżka domknięta do dolnej krawędzi — pod linią kładziemy wypełnienie. */
	let obszar = $derived(
		punkty.length > 1
			? `${linia} L${punkty[punkty.length - 1].x.toFixed(1)} ${height} L${punkty[0].x.toFixed(1)} ${height} Z`
			: ''
	);

	let ostatni = $derived(punkty[punkty.length - 1]);
</script>

{#if punkty.length > 0}
	<svg
		class="spark"
		{width}
		{height}
		viewBox="0 0 {width} {height}"
		role="img"
		aria-label={label}
		style="color: {color}"
	>
		{#if obszar}
			<path d={obszar} fill="currentColor" opacity="0.12" />
		{/if}
		<path
			d={linia}
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		{#if ostatni}
			<circle cx={ostatni.x} cy={ostatni.y} r={DOT} fill="currentColor" />
		{/if}
	</svg>
{/if}

<style>
	.spark {
		display: block;
		overflow: visible;
	}
</style>
