<script lang="ts">
	interface Point {
		label: string;
		value: number;
		/** Pełniejsza etykieta do tooltipa (domyślnie label). */
		title?: string;
	}

	let {
		data,
		color = 'var(--color-primary)',
		height = 180,
		maxXLabels = 10
	}: {
		data: Point[];
		color?: string;
		height?: number;
		maxXLabels?: number;
	} = $props();

	const PAD_LEFT = 34;
	const PAD_BOTTOM = 22;
	const PAD_TOP = 8;
	const width = 720;

	let max = $derived(Math.max(1, ...data.map((d) => d.value)));
	let innerW = $derived(width - PAD_LEFT);
	let innerH = $derived(height - PAD_BOTTOM - PAD_TOP);
	let step = $derived(innerW / Math.max(1, data.length));
	let barW = $derived(Math.max(3, Math.min(40, step - 2)));
	let labelEvery = $derived(Math.max(1, Math.ceil(data.length / maxXLabels)));
	// Set usuwa duplikaty (przy max=1 obie linie siatki wypadałyby na 1)
	let gridValues = $derived([...new Set([0.5, 1].map((f) => Math.round(max * f)))]);
</script>

{#if data.length === 0}
	<p class="muted" style="font-size: var(--text-sm)">Brak danych do wyświetlenia.</p>
{:else}
	<svg
		viewBox="0 0 {width} {height}"
		role="img"
		aria-label="Wykres słupkowy"
		style="width: 100%; height: auto; display: block"
	>
		{#each gridValues as gv (gv)}
			{@const y = PAD_TOP + innerH - (gv / max) * innerH}
			<line x1={PAD_LEFT} x2={width} y1={y} y2={y} stroke="var(--color-border)" stroke-width="1" />
			<text
				x={PAD_LEFT - 6}
				y={y + 3}
				text-anchor="end"
				font-size="10"
				fill="var(--color-text-faint)">{gv}</text
			>
		{/each}
		<line
			x1={PAD_LEFT}
			x2={width}
			y1={PAD_TOP + innerH}
			y2={PAD_TOP + innerH}
			stroke="var(--color-text-faint)"
			stroke-width="1"
		/>
		{#each data as d, i (i)}
			{@const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * innerH)}
			{@const x = PAD_LEFT + i * step + (step - barW) / 2}
			<g class="bar">
				<!-- zaokrąglony tylko górny koniec: clip słupka do prostokąta z rx -->
				<rect
					{x}
					y={PAD_TOP + innerH - h}
					width={barW}
					height={h + 4}
					rx="4"
					fill={color}
					clip-path="inset(0 0 4px 0)"
				>
					<title>{d.title ?? d.label}: {d.value}</title>
				</rect>
				{#if i % labelEvery === 0}
					<text
						x={x + barW / 2}
						y={height - 6}
						text-anchor="middle"
						font-size="10"
						fill="var(--color-text-faint)">{d.label}</text
					>
				{/if}
			</g>
		{/each}
	</svg>
{/if}

<style>
	.bar rect {
		transition: opacity 120ms;
	}
	.bar:hover rect {
		opacity: 0.75;
	}
</style>
