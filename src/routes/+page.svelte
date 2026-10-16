<script lang="ts">
	import { onMount } from 'svelte';
	import type { countData } from '$lib/types';

	interface Project {
		projectId: string;
		secretKey: string;
		settings: any | undefined;
	}

	let projects: Project[] = [];
	let showGuideModal = false;
	let showCreateModal = false;
	let selectedProject: Project | null = null;
	let origin = '';

	let count_data: countData = {
		total_time_ms: 0,
		uid_count: 0,
		project_count: 0,
		build_count: 0
	};
	let newProjectEmail = '';
	let isCreating = false;

	onMount(async () => {
		// Get from localStorage
		const storedProjects = localStorage.getItem('projects');
		if (storedProjects) {
			projects = JSON.parse(storedProjects);
		}
		origin = window.location.origin;

		// Fetch global count
		try {
			const res = await fetch('/api/count');
			if (res.ok) {
				const data = await res.json();
				let total_time_hr = data.total_time_ms / 1000 / 60 / 60; // Convert ms to hours

				// Round to 1 decimal place
				total_time_hr = Math.round(total_time_hr * 10) / 10;

				count_data = {
					total_time_ms: total_time_hr,
					uid_count: data.uid_count,
					project_count: data.project_count,
					build_count: data.build_count
				};
			}
		} catch (e) {
			console.error('Failed to fetch count', e);
		}
	});

	const updateLocalStorage = () => {
		localStorage.setItem('projects', JSON.stringify(projects));
	};

	const openCreateModal = () => {
		newProjectEmail = '';
		showCreateModal = true;
	};

	const closeCreateModal = () => {
		showCreateModal = false;
	};

	const submitCreateProject = async () => {
		if (!newProjectEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newProjectEmail)) {
			alert('Please enter a valid email address.');
			return;
		}

		isCreating = true;
		try {
			let response = await fetch(`/api/registration?email=${encodeURIComponent(newProjectEmail)}`, {
				method: 'GET'
			});

			if (!response.ok) {
				alert('Failed to create a new project. Reason: ' + (await response.text()));
				return;
			}

			alert('New project created. Please check your email for configuration details.');
			closeCreateModal();
			updateLocalStorage();
		} catch (e) {
			alert('Error creating project: ' + e);
		} finally {
			isCreating = false;
		}
	};

	const handleAddExisting = () => {
		const existingSecretKey = prompt('Enter Secret Key:');

		console.log('Existing Secret Key:', existingSecretKey);
		if (existingSecretKey) {
			projects = [
				...projects,
				{ projectId: 'Unknown', secretKey: existingSecretKey, settings: undefined }
			];
			updateLocalStorage();
		}
	};

	const openGuide = (project: Project) => {
		selectedProject = project;
		showGuideModal = true;
	};

	const closeGuide = () => {
		showGuideModal = false;
		selectedProject = null;
	};
</script>

<div class="page-wrapper">
	<section class="hero">
		<div class="hero-content">
			<h1 class="title">
				Simple Statistic Services for Interactive CYOA <span class="acronym">(SSSIC)</span>
			</h1>
			<p class="subtitle">Empower your interactive stories with real-time analytics.</p>

			<div class="stat-container">
				<div class="stat-value">{count_data.total_time_ms.toLocaleString()}</div>
				<div class="stat-label">hours recorded</div>
				<br />
				<div class="stat-value">{count_data.uid_count.toLocaleString()}</div>
				<div class="stat-label">unique users</div>
				<br />
				<div class="stat-value">{count_data.project_count.toLocaleString()}</div>
				<div class="stat-label">projects registered</div>
			</div>

			<div class="hero-actions">
				<button onclick={openCreateModal} class="btn primary large">New Project</button>
				<button onclick={handleAddExisting} class="btn secondary large">Add Existing Project</button
				>
			</div>
		</div>
	</section>

	<main class="container">
		<h2 class="section-header">Your Projects</h2>
		<div class="project-list">
			{#each projects as project, index (project.secretKey)}
				<div class="project-card">
					<div class="card-info">
						<h3>Project #{index + 1}</h3>
						<span class="project-meta">Key: {project.secretKey.substring(0, 8)}...</span>
					</div>
					<div class="card-actions">
						<a href="/statistics/{project.secretKey}" class="btn link">Go to Statistics</a>
						<button onclick={() => openGuide(project)} class="btn info">Initialization Guide</button
						>
					</div>
				</div>
			{/each}
			{#if projects.length === 0}
				<div class="empty-state">
					<p>No projects registered locally.</p>
					<p class="empty-sub">Create a new project or add an existing one to start tracking.</p>
				</div>
			{/if}
		</div>
	</main>
</div>

{#if showCreateModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={closeCreateModal}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h2>Create New Project</h2>
			<p class="modal-desc">Enter your email address to receive your project Secret Key.</p>

			<div class="input-group">
				<input
					type="email"
					bind:value={newProjectEmail}
					placeholder="your-email@example.com"
					class="text-input"
					onkeydown={(e) => e.key === 'Enter' && submitCreateProject()}
				/>
			</div>

			<div class="modal-actions">
				<button onclick={closeCreateModal} class="btn text">Cancel</button>
				<button onclick={submitCreateProject} class="btn primary" disabled={isCreating}>
					{isCreating ? 'Creating...' : 'Create Project'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showGuideModal && selectedProject}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={closeGuide}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h2>Initialization Guide</h2>
			<p>
				Add the following script tag to your CYOA's <code>index.html</code> file, inside the
				<code>&lt;body&gt;</code> tag:
			</p>
			<pre>
&lt;body&gt;
  ...
  &lt;script src="{origin}/logger.js"&gt;&lt;/script&gt;
  &lt;script&gt;
    initializeLogging("{selectedProject.projectId}");
  &lt;/script&gt;
&lt;/body&gt;
            </pre>
			<div class="modal-actions">
				<button onclick={closeGuide} class="btn secondary">Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;500;600;800&family=Inter:wght@300;400;500&display=swap');

	:global(body) {
		margin: 0;
		font-family: 'Inter', sans-serif;
		background-color: #f9f9f9;
		color: #222;
		font-weight: 300;
	}

	.page-wrapper {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	/* Hero Section */
	.hero {
		background-color: #0f172a;
		color: #fff;
		padding: 6rem 2rem;
		text-align: center;
		position: relative;
		overflow: hidden;
	}

	.hero-content {
		max-width: 900px;
		margin: 0 auto;
		position: relative;
		z-index: 2;
	}

	.title {
		font-family: 'Bodoni Moda', serif;
		font-size: 3.5rem;
		font-weight: 600;
		margin: 0 0 1rem 0;
		line-height: 1.1;
		letter-spacing: -0.02em;
	}

	.acronym {
		font-weight: 400;
		font-style: italic;
		opacity: 0.7;
		font-size: 0.8em;
	}

	.subtitle {
		font-size: 1.1rem;
		opacity: 0.8;
		margin-bottom: 4rem;
		font-weight: 300;
		letter-spacing: 0.02em;
		max-width: 600px;
		margin-left: auto;
		margin-right: auto;
	}

	.stat-container {
		margin: 2rem 0 4rem;
		padding: 0 2rem;
		display: inline-block;
		border-left: 1px solid rgba(255, 255, 255, 0.2);
		border-right: 1px solid rgba(255, 255, 255, 0.2);
	}

	.stat-value {
		font-family: 'Bodoni Moda', serif;
		font-size: 6rem;
		font-weight: 500;
		line-height: 1;
	}

	.stat-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		opacity: 0.6;
		margin-top: 1rem;
	}

	.hero-actions {
		display: flex;
		gap: 1.5rem;
		justify-content: center;
		margin-top: 2rem;
	}

	/* Main Content */
	.container {
		max-width: 900px;
		margin: 4rem auto;
		padding: 0 2rem;
		width: 100%;
		box-sizing: border-box;
	}

	.section-header {
		font-family: 'Bodoni Moda', serif;
		font-size: 2rem;
		margin-bottom: 2rem;
		color: #111;
		border-bottom: 1px solid #eee;
		padding-bottom: 1rem;
		font-weight: 500;
	}

	.project-list {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.project-card {
		background: white;
		border: 1px solid #e0e0e0;
		padding: 2rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		transition: all 0.3s ease;
	}

	.project-card:hover {
		border-color: #000;
		transform: translateY(-2px);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
	}

	.card-info h3 {
		font-family: 'Bodoni Moda', serif;
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
		color: #000;
		font-weight: 500;
	}

	.project-meta {
		font-size: 0.8rem;
		color: #666;
		font-family: 'Inter', monospace;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.card-actions {
		display: flex;
		gap: 1rem;
	}

	.empty-state {
		text-align: center;
		padding: 6rem 2rem;
		background: white;
		border: 1px solid #eee;
		color: #888;
	}

	.empty-sub {
		font-size: 0.85rem;
		margin-top: 0.5rem;
		font-weight: 300;
	}

	/* Buttons */
	.btn {
		padding: 0.8rem 2rem;
		border: 1px solid transparent;
		border-radius: 0; /* No roundness */
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 500;
		text-decoration: none;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		transition: all 0.3s ease;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.btn.large {
		padding: 1rem 2.5rem;
		font-size: 0.9rem;
	}

	.btn.primary {
		background-color: #fff;
		color: #000;
		border-color: #fff;
	}

	.btn.primary:hover {
		background-color: transparent;
		color: #fff;
	}

	/* In modal/light context */
	.modal .btn.primary {
		background-color: #000;
		color: #fff;
		border-color: #000;
	}
	.modal .btn.primary:hover {
		background-color: #333;
		border-color: #333;
	}

	.btn.secondary {
		background-color: transparent;
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.3);
	}

	.btn.secondary:hover {
		border-color: #fff;
		background-color: rgba(255, 255, 255, 0.05);
	}

	/* Secondary button in light context */
	.modal .btn.secondary {
		background-color: transparent;
		color: #666;
		border: 1px solid #ddd;
	}
	.modal .btn.secondary:hover {
		border-color: #000;
		color: #000;
	}

	.btn.link {
		background-color: #000;
		color: white;
		border: 1px solid #000;
	}
	.btn.link:hover {
		background-color: white;
		color: #000;
	}

	.btn.info {
		background-color: white;
		color: #000;
		border: 1px solid #ddd;
	}
	.btn.info:hover {
		border-color: #000;
	}

	.btn.text {
		background: none;
		color: #666;
		padding: 0.8rem 1.5rem;
	}
	.btn.text:hover {
		color: #000;
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.8);
		backdrop-filter: blur(5px);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 1000;
		animation: fadeIn 0.3s ease-out;
	}

	.modal {
		background: white;
		padding: 3rem;
		border-radius: 0; /* Sharp corners */
		max-width: 500px;
		width: 90%;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
		border: 1px solid #eee;
	}

	.modal h2 {
		margin-top: 0;
		color: #000;
		font-family: 'Bodoni Moda', serif;
		font-weight: 500;
		font-size: 1.8rem;
	}

	.modal-desc {
		color: #666;
		margin-bottom: 2rem;
		font-size: 0.9rem;
		line-height: 1.6;
	}

	.input-group {
		margin-bottom: 2.5rem;
	}

	.text-input {
		width: 100%;
		padding: 1rem;
		border: none;
		border-bottom: 1px solid #ddd;
		border-radius: 0;
		font-size: 1rem;
		font-family: 'Bodoni Moda', serif;
		transition: border-color 0.3s;
		box-sizing: border-box;
		background: transparent;
	}

	.text-input:focus {
		outline: none;
		border-color: #000;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
	}

	pre {
		background: #f8f8f8;
		padding: 1.5rem;
		border-radius: 0;
		overflow-x: auto;
		margin: 1.5rem 0;
		font-family: 'Fira Code', monospace;
		border: 1px solid #eee;
		font-size: 0.85rem;
		color: #444;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideUp {
		from {
			transform: translateY(30px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
