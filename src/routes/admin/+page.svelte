<script lang="ts">
	import StatisticsViewer from '$lib/components/statisticsViewer.svelte';

	export let data;

	let selectedProjectId = '';
</script>

<div class="admin-section">
	<h2>Projects</h2>
	<select bind:value={selectedProjectId}>
		<option value="" disabled>Select a project</option>
		{#each data.projects as project}
			<option value={project.project_id}
				>{project.project_id} - {project.sample_url} - {project.last_updated}</option
			>
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
</style>
