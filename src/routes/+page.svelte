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
		// Ask email for registration
		const email = prompt('Enter your email for project registration:');

		// Validate email format - WE HAVE TO CHECK THIS ON THE SERVER SIDE AS WELL
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			alert('Please enter a valid email address.');
			return;
		}

		// Fetch to registration API to create new project
		let response = await fetch(`/api/registration?email=${encodeURIComponent(email)}`, {
			method: 'GET'
		});

		// Check status
		if (!response.ok) {
			alert('Failed to create a new project. Reason: ' + (await response.text()));
			return;
		}

		alert('New project created. Please check your email for configuration details.');
		updateLocalStorage();
	};

	const handleAddExisting = () => {
		// TODO: Implement adding existing project
		const existingSecretKey = prompt('Enter Secret Key:');

		console.log('Existing Secret Key:', existingSecretKey);
		// Update projects array accordingly
		if (existingSecretKey) {
			projects = [
				...projects,
				{ projectId: 'Unknown', secretKey: existingSecretKey, settings: undefined }
			];
		}

		updateLocalStorage();
	};
</script>

<h1 class="text-2xl font-bold mb-4">Manage Projects</h1>
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
