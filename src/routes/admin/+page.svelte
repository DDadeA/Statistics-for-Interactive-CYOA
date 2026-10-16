<script lang="ts">
	import StatisticsViewer from '$lib/components/statisticsViewer.svelte';

	export let data;

	let selectedProjectId = '';
	let activityData: { date: string; count: number }[] = [];
	let activityCanvas: HTMLCanvasElement;
	let activityMessage = '';

	function drawActivityGraph(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
		const padding = 40;
		const width = canvas.width - 2 * padding;
		const height = canvas.height - 2 * padding;

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		if (activityData.length === 0) {
			ctx.fillText('No data available', canvas.width / 2 - 50, canvas.height / 2);
			return;
		}

		const maxCount = Math.max(...activityData.map((d) => d.count));
		const barWidth = width / activityData.length;

		ctx.strokeStyle = '#000';
		ctx.beginPath();
		ctx.moveTo(padding, padding);
		ctx.lineTo(padding, canvas.height - padding);
		ctx.lineTo(canvas.width - padding, canvas.height - padding);
		ctx.stroke();

		ctx.fillStyle = '#4CAF50';
		activityData.forEach((point, index) => {
			const barHeight = (point.count / maxCount) * height;
			const x = padding + index * barWidth;
			const y = canvas.height - padding - barHeight;
			ctx.fillRect(x + 2, y, barWidth - 4, barHeight);
		});

		ctx.fillStyle = '#000';
		ctx.font = 'bold 14px Arial';
		ctx.fillText('All projects - Activity', 10, 20);
	}

	async function loadActivityGraphData() {
		activityMessage = 'Loading activity...';
		try {
			const response = await fetch('/admin/api/log?limit=10000');
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const results: { created_at: string }[] = (await response.json()).results;

			const counts: Record<string, number> = {};
			for (const item of results) {
				const dateKey = item.created_at.split('T')[0];
				counts[dateKey] = (counts[dateKey] || 0) + 1;
			}
			activityData = Object.entries(counts).map(([date, count]) => ({ date, count }));
			activityMessage = '';

			const ctx = activityCanvas?.getContext('2d');
			if (ctx) drawActivityGraph(ctx, activityCanvas);
		} catch (error) {
			console.error('Failed to load activity data:', error);
			activityMessage = `Failed to load activity (${error instanceof Error ? error.message : error}).`;
		}
	}
</script>

<div class="admin-section">
	<h2>Activity Graph</h2>
	<button on:click={loadActivityGraphData}>Load Activity Graph Data</button>
	{#if activityMessage}<p class="message">{activityMessage}</p>{/if}
	<canvas bind:this={activityCanvas}></canvas>
</div>

<div class="admin-section">
	<h2>Projects</h2>
	<select bind:value={selectedProjectId}>
		<option value="" disabled>Select a project</option>
		{#each data.projects as project}
			<option value={project.project_id}>{project.project_id} - {project.sample_url}</option>
		{/each}
	</select>
</div>

{#if selectedProjectId}
	{#key selectedProjectId}
		<StatisticsViewer
			endpoint="/admin/api/log"
			params={{ project_id: selectedProjectId }}
			autoLoad
		/>
	{/key}
{/if}

<style>
	.admin-section {
		margin: 0 auto 20px;
		max-width: 1200px;
		padding: 0 20px;
	}

	.message {
		font-style: italic;
		color: #555;
	}
</style>
