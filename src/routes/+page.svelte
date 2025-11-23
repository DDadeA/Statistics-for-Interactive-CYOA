<script lang="ts">
	import { onMount } from 'svelte';

	interface Project {
		projectId: string;
		secretKey: string;
		settings: any | undefined;
	}

	let projects: Project[] = [];

	onMount(() => {
		// Get from localStorage
		const storedProjects = localStorage.getItem('projects');
		if (storedProjects) {
			projects = JSON.parse(storedProjects);
		}
	});

	const updateLocalStorage = () => {
		localStorage.setItem('projects', JSON.stringify(projects));
	};

	const handleCreateNew = async () => {
		// Fetch to registration API to create new project
		let response = await fetch('/api/registration', {
			method: 'GET'
		});
		let data = await response.json();
		console.log('New Project Data:', data);
		if (data.projectId && data.secretKey) {
			projects = [
				...projects,
				{ projectId: data.projectId, secretKey: data.secretKey, settings: undefined }
			];
		} else {
			alert('Failed to create new project. Please try again.');
			return;
		}
		updateLocalStorage();
	};

	const handleAddExisting = () => {
		// TODO: Implement adding existing project
		const existingSecretKey = prompt('Enter Secret Key:');

		console.log('Existing Secret Key:', existingSecretKey);

		updateLocalStorage();
	};
</script>

<p>Here is the registration page.</p>
<div>
	<button onclick={handleCreateNew}>Create New Project</button>
	<button onclick={handleAddExisting}>Add Existing Project</button>
</div>
<div>
	{#each projects as { projectId, secretKey }, index (projectId)}
		<div class="mb-4 p-4 border rounded">
			<h2 class="text-lg font-bold mb-2">Project ID {index + 1}</h2>
			<p><strong>Project ID:</strong> {projectId}</p>
			<p><strong>Secret Key:</strong> {secretKey}</p>
			<p class="text-sm text-gray-600 mt-2">
				Please store your secret key securely. You will need it to access your statistics.
			</p>
		</div>
	{/each}
	{#if projects.length === 0}
		<p>No projects registered yet. Please create a new project or add an existing one.</p>
	{/if}
</div>
