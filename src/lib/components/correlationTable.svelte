<script lang="ts">
	import type { correlationObject } from '$lib/types';
	import { correlationSortFunctions } from '$lib/correlationSortFunctions';

	let { t, filteredLogData, objectMap } = $props();

	let correlationLimit: number = $state(10);
	let enableCorrelation: boolean = $state(false);
	let correlationSortFunction: (a: correlationObject, b: correlationObject) => number = $state(
		correlationSortFunctions[0].value
	);

	const maxCorrelationEntries = 3000;

	let correlationResult = $derived.by(() => {
		if (!enableCorrelation || !filteredLogData || filteredLogData.length === 0) {
			return { correlations: [], message: '' };
		}

		const totalEntries = filteredLogData.length;
		const sampled =
			totalEntries > maxCorrelationEntries
				? Array.from({ length: maxCorrelationEntries }, (_, index) => {
						const sourceIndex = Math.floor(
							(index * (totalEntries - 1)) / (maxCorrelationEntries - 1)
						);
						return filteredLogData[sourceIndex];
					})
				: filteredLogData;
		const sampleCounts: Record<string, number> = {};
		const pairCounts = new Map<string, number>();

		for (const entry of sampled) {
			const choices: unknown = entry.parsedData?.selectedChoices;
			if (!Array.isArray(choices) || choices.length < 2) continue;

			const uniqueChoices = [
				...new Set(
					choices.filter((choice: unknown): choice is string => typeof choice === 'string')
				)
			];
			for (const choice of uniqueChoices) {
				sampleCounts[choice] = (sampleCounts[choice] || 0) + 1;
			}

			for (let i = 0; i < uniqueChoices.length; i++) {
				const choiceA = uniqueChoices[i];
				for (let j = i + 1; j < uniqueChoices.length; j++) {
					const key = JSON.stringify([choiceA, uniqueChoices[j]]);
					pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
				}
			}
		}

		const correlations = Array.from(pairCounts.entries()).map(([key, count]) => {
			const [idA, idB] = JSON.parse(key) as [string, string];
			const countA = sampleCounts[idA] || 0;
			const countB = sampleCounts[idB] || 0;

			const percent = (count / sampled.length) * 100;
			const probA = countA / sampled.length;
			const probB = countB / sampled.length;
			const lift = probA * probB > 0 ? percent / 100 / (probA * probB) : 0;

			return { idA, idB, count, percent, probA, probB, lift };
		});
		return {
			correlations,
			message: totalEntries > maxCorrelationEntries ? t.correlationLimitMessage : ''
		};
	});

	let sortedTopCorrelations = $derived.by(() => {
		return [...correlationResult.correlations].sort(correlationSortFunction);
	});

	let slicedSortedTopCorrelations = $derived.by(() => {
		return sortedTopCorrelations.slice(0, correlationLimit);
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
	<p id="correlationTableMessage" class="text-gray-600 italic">{correlationResult.message}</p>
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

<style>
	#correlations {
		margin-bottom: 2rem;
	}
	#correlationSort {
		margin-bottom: 1rem;
	}
	.number-input {
		width: 60px;
		padding: 0.25rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		background-color: white;
		font-size: 0.875rem;
		color: #111827;
		cursor: pointer;
		margin-left: 1rem;
	}
	.correlation-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}

	.correlation-card {
		background-color: #f9f9f9;
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 1rem;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.correlation-pair {
		font-weight: bold;
		margin-bottom: 0.5rem;
	}

	.separator {
		margin: 0 0.5rem;
		color: #888;
	}

	.correlation-stat {
		display: flex;
		flex-direction: column;
		font-size: 0.9rem;
		color: #555;
	}

	.lift {
		color: #007bff;
	}
	.count {
		color: #28a745;
	}
	.percent {
		color: #6c757d;
	}
</style>
