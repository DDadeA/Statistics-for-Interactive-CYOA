<script lang="ts">
	import type { correlationObject } from '$lib/types';
	import { correlationSortFunctions } from '$lib/correlationSortFunctions';

	let { t, filteredLogData, statisticsCounts, objectMap } = $props();

	let correlationLimit: number = $state(10);
	let enableCorrelation: boolean = $state(true);
	let correlationSortFunction: (a: correlationObject, b: correlationObject) => number = $state(
		correlationSortFunctions[0].value
	);

	let topCorrelations = $derived.by(() => {
		if (!enableCorrelation) return [];
		if (!filteredLogData) return [];
		if (filteredLogData.length === 0) return [];

		console.time('(3-1) Correlations Calculation Time');
		const pairCounts = new Map<string, number>();
		const totalEntries = filteredLogData.length;

		for (const entry of filteredLogData) {
			const choices = entry.parsedData.selectedChoices;
			if (!choices || choices.length < 2) continue;

			// Choices are already sorted in parsedLogData (Step A)
			const len = choices.length;

			// O(Choices^2) per user, but O(N * C^2) total.
			for (let i = 0; i < len; i++) {
				const choiceA = choices[i];
				for (let j = i + 1; j < len; j++) {
					const key = `${choiceA}|${choices[j]}`;
					pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
				}
			}
		}

		const correlations = Array.from(pairCounts.entries()).map(([key, count]) => {
			const [idA, idB] = key.split('|');
			const countA = statisticsCounts[idA] || 0;
			const countB = statisticsCounts[idB] || 0;

			const percent = (count / totalEntries) * 100;
			const probA = countA / totalEntries;
			const probB = countB / totalEntries;
			const lift = probA * probB > 0 ? percent / 100 / (probA * probB) : 0;

			return { idA, idB, count, percent, probA, probB, lift };
		});
		console.timeEnd('(3-1) Correlations Calculation Time');
		return correlations;
	});

	let sortedTopCorrelations = $derived.by(() => {
		console.time('(3-2) Correlation Sorting Time');

		// Create a copy to make sure it's reactive
		const correlationsCopy = [...topCorrelations];
		const sorted = correlationsCopy.sort(correlationSortFunction);
		console.timeEnd('(3-2) Correlation Sorting Time');
		return sorted;
	});

	let slicedSortedTopCorrelations = $derived.by(() => {
		console.time('(3-3) Correlation Slicing Time');

		const sliced = sortedTopCorrelations.slice(0, correlationLimit);
		console.timeEnd('(3-3) Correlation Slicing Time');
		return sliced;
	});
</script>

<!-- Choice Correlations -->
<h2 id="correlations">{t.choiceCorrelations} (top {correlationLimit})</h2>
<select id="correlationSort" bind:value={correlationSortFunction}>
	{#each correlationSortFunctions as option}
		<option value={option.value} selected={option.value == correlationSortFunctions[0].value}
			>{option.label}</option
		>
	{/each}
</select>
<input type="range" min="1" max="100" step="1" bind:value={correlationLimit} class="number-input" />
<input type="checkbox" id="enableCorrelation" bind:checked={enableCorrelation} />
<label for="enableCorrelation">{t.enableCorrelation}</label>
{#if !enableCorrelation}
	<p class="text-red-600 italic">{t.correlationDisabled}</p>
{/if}
<div class="correlation-grid">
	{#each slicedSortedTopCorrelations as corr}
		{@const objA = objectMap[corr.idA]}
		{@const objB = objectMap[corr.idB]}
		<div class="correlation-card">
			<div class="correlation-pair">
				<span title={corr.idA}>{objA ? objA.title || corr.idA : corr.idA}</span>
				<span class="separator">+</span>
				<span title={corr.idB}>{objB ? objB.title || corr.idB : corr.idB}</span>
			</div>
			<div class="correlation-stat">
				<span class="lift">Lift: {corr.lift.toFixed(2)}</span>
				<span class="count">{corr.count}</span>
				<span class="percent">({corr.percent.toFixed(1)}%)</span>
			</div>
		</div>
	{/each}
	{#if slicedSortedTopCorrelations.length === 0}
		<p class="text-gray italic">{t.noCorrelations}</p>
	{/if}
</div>
