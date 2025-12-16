<script>
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="layout-container">
	<main class="main-content">
		{@render children?.()}
	</main>

	<footer class="footer">
		<div class="footer-content">
			<p class="copyright">
				© 2025 CYOA Analytics. <span class="divider">|</span>
				Free-to-use personal project for educational purposes.
			</p>

			<div class="links">
				<a
					href="https://github.com/DDadeA/Statistics-for-Interactive-CYOA#service-notice--privacy-disclaimer"
					target="_blank"
					rel="noopener noreferrer"
				>
					Terms & Privacy
				</a>

				<span class="divider">|</span>
				<a
					href="https://github.com/DDadeA/Statistics-for-Interactive-CYOA"
					target="_blank"
					rel="noopener noreferrer"
				>
					GitHub Source
				</a>

				<span class="divider">|</span>

				<a
					href="https://nowpayments.io/donation/sssic"
					target="_blank"
					rel="noopener noreferrer"
					class="support-link"
				>
					Support (Crypto)
				</a>
			</div>
		</div>
	</footer>
</div>

<style>
	.layout-container {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background-color: #f9fafb;
		color: #111827;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
	}

	.main-content {
		flex: 1;
		width: 100%;
	}

	.footer {
		background-color: #ffffff;
		border-top: 1px solid #e5e7eb;
		padding: 2rem 0;
		text-align: center;
		font-size: 0.875rem;
		color: #6b7280;
	}

	.footer-content {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1rem;
	}

	.copyright {
		margin-bottom: 0.75rem;
	}

	.links {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	a {
		color: #4b5563;
		text-decoration: none;
		transition: color 0.2s;
	}

	a:hover {
		color: #111827;
		text-decoration: underline;
	}

	.support-link {
		font-weight: 600;
		color: #4b5563;
	}

	.divider {
		color: #d1d5db;
		margin: 0 0.25rem;
	}
	@media (max-width: 640px) {
		.divider {
			display: none;
		}
		.links {
			flex-direction: column;
			gap: 0.75rem;
		}
	}
</style>
