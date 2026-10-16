<script lang="ts">
	import { onMount } from 'svelte';
	import type { LogEntry } from '$lib/types';
	import StatisticsViewer from '$lib/components/statisticsViewer.svelte';

	let secretKey = '';

	onMount(() => {
		const urlParts = window.location.pathname.split('/');
		const key = urlParts[urlParts.length - 1];

		// Validate secretKey format (basic check)
		if (!key || key.length !== 36) {
			console.error('Invalid secret key format');
			return;
		}
		secretKey = key;
	});

	function addToSavedProjects(entries: LogEntry[]) {
		if (entries.length === 0) return;

		const storedProjects = localStorage.getItem('projects');
		let projects: { projectId: string; secretKey: string; settings: any }[] = [];
		if (storedProjects) {
			try {
				projects = JSON.parse(storedProjects);
			} catch (e) {
				console.error('Error parsing projects from localStorage', e);
			}
		}

		if (!projects.some((p) => p.secretKey === secretKey)) {
			projects.push({ projectId: entries[0].project_id, secretKey, settings: undefined });
			localStorage.setItem('projects', JSON.stringify(projects));
		}
	}
</script>

{#if secretKey}
	<StatisticsViewer
		endpoint="/api/log"
		headers={{ Authorization: `Bearer ${secretKey}` }}
		projectCacheKey={secretKey}
		onLoaded={addToSavedProjects}
	/>
{/if}
