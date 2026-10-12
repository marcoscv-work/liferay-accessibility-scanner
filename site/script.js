/* Small progressive enhancements: mobile nav, scroll reveal, current year. */
(function () {
	const toggle = document.querySelector('.nav-toggle');
	const nav = document.querySelector('.site-nav');
	if (toggle && nav) {
		toggle.addEventListener('click', () => {
			const open = nav.getAttribute('data-open') === 'true';
			nav.setAttribute('data-open', String(!open));
			toggle.setAttribute('aria-expanded', String(!open));
		});
		nav.addEventListener('click', (event) => {
			if (event.target.closest('a')) {
				nav.setAttribute('data-open', 'false');
				toggle.setAttribute('aria-expanded', 'false');
			}
		});
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
				nav.setAttribute('data-open', 'false');
				toggle.setAttribute('aria-expanded', 'false');
				toggle.focus();
			}
		});
	}

	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const targets = document.querySelectorAll('.reveal');
	if (reduced || !('IntersectionObserver' in window)) {
		targets.forEach((el) => el.classList.add('is-visible'));
	}
	else {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						entry.target.classList.add('is-visible');
						observer.unobserve(entry.target);
					}
				});
			},
			{rootMargin: '0px 0px -10% 0px', threshold: 0.1}
		);
		targets.forEach((el) => observer.observe(el));
	}

	const year = document.querySelector('[data-year]');
	if (year) {
		year.textContent = String(new Date().getFullYear());
	}
})();
