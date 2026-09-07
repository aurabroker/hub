<script lang="ts">
	interface Point {
		label: string;
		value: number;
	}

	let {
		data,
		color = 'var(--color-primary)',
		height = 200
	}: { data: Point[]; color?: string; height?: number } = $props();

	const WIDTH = 760;
	const PAD_LEFT = 38;
	const PAD_RIGHT = 8;
	const PAD_TOP = 12;
	const PAD_BOTTOM = 24;

	// Unikalny identyfikator gradientu: dwa wykresy na stronie nie mogą dzielić
	// jednego <defs id>, bo drugi przejąłby wypełnienie pierwszego.
	const uid = `area-${Math.random().toString(36).slice(2, 9)}`;

	let innerW = $derived(WIDTH - PAD_LEFT - PAD_RIGHT);
	let innerH = $derived(height - PAD_TOP - PAD_BOTTOM);
	let max = $derived(Math.max(1, ...data.map((d) => d.value)));

	/** Przy jednym punkcie nie ma odcinka — rysujemy go na środku, nie w rogu. */
	let step = $derived(data.length > 1 ? innerW / (data.length - 1) : 0);
	let x = $derived((i: number) => (data.length > 1 ? PAD_LEFT + i * step : PAD_LEFT + innerW / 2));
	let y = $derived((v: number) => PAD_TOP + innerH - (v / max) * innerH);

	let line = $derived(data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' '));
	let area = $derived(
		data.length === 0
			? ''
			: `${line} L${x(data.length - 1)},${PAD_TOP + innerH} L${x(0)},${PAD_TOP + innerH} Z`
	);

	// Trzy poziomy siatki wystarczą, żeby odczytać rząd wielkości bez zaśmiecania.
	let grid = $derived([...new Set([0, 0.5, 1].map((f) => Math.round(max * f)))]);

	/** Ile etykiet osi zmieści się bez nachodzenia na siebie. */
	let labelEvery = $derived(Math.max(1, Math.ceil(data.length / 8)));
</script>

{#if data.length === 0}
	<p class="muted" style="font-size: var(--text-sm); margin: 0">Brak danych w tym okresie.</p>
{:else}
	<svg
		viewBox="0 0 {WIDTH} {height}"
		role="img"
		aria-label="Odsłony w czasie"
		style="width: 100%; height: auto; display: block"
	>
		<defs>
			<linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.28" />
				<stop offset="100%" stop-color={color} stop-opacity="0.02" />
			</linearGradient>
		</defs>

		{#each grid as gv (gv)}
			{@const gy = y(gv)}
			<line
				x1={PAD_LEFT}
				x2={WIDTH - PAD_RIGHT}
				y1={gy}
				y2={gy}
				stroke="var(--color-border)"
				stroke-width="1"
			/>
			<text x={PAD_LEFT - 8} y={gy + 3} text-anchor="end" font-size="10" fill="var(--color-text-faint)"
				>{gv}</text
			>
		{/each}

		<path d={area} fill="url(#{uid})" />
		<path
			d={line}
			fill="none"
			stroke={color}
			stroke-width="2"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>

		{#each data as d, i (i)}
			<g class="pt">
				<circle cx={x(i)} cy={y(d.value)} r="3.5" fill={color} class="dot" />
				<!-- Przezroczysty pas na całą wysokość: łatwiej trafić kursorem niż w sam punkt. -->
				<rect
					x={x(i) - (step || innerW) / 2}
					y={PAD_TOP}
					width={step || innerW}
					height={innerH}
					fill="transparent"
				>
					<title>{d.label}: {d.value}</title>
				</rect>
			</g>
			{#if i % labelEvery === 0 || i === data.length - 1}
				<text
					x={x(i)}
					y={height - 6}
					text-anchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
					font-size="10"
					fill="var(--color-text-faint)">{d.label}</text
				>
			{/if}
		{/each}
	</svg>
{/if}

<style>
	/* Punkty pojawiają się dopiero pod kursorem — przy trzydziestu dniach ciąg
	   kropek zasłania kształt krzywej, a to on niesie informację. */
	.dot {
		opacity: 0;
		transition: opacity 120ms;
	}
	.pt:hover .dot {
		opacity: 1;
	}
</style>
