const toast = document.querySelector('.toast');
let toastTimer;

async function copyText(text, trigger) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }

  const original = trigger.querySelector('.copy-label')?.textContent;
  const actionLabel = trigger.querySelector('.copy-label') || trigger.querySelector('span:last-child');
  if (actionLabel) actionLabel.textContent = 'Copied ✓';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    if (actionLabel) actionLabel.textContent = original || 'Copy ↗';
  }, 1800);
}

document.querySelector('.copy-install')?.addEventListener('click', (event) => {
  copyText(event.currentTarget.dataset.copy, event.currentTarget);
});

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => copyText(button.dataset.command, button));
});

const header = document.querySelector('.site-header');
const menuButton = document.querySelector('.menu-button');
menuButton?.addEventListener('click', () => {
  const isOpen = header.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
});

document.querySelectorAll('nav a').forEach((link) => {
  link.addEventListener('click', () => {
    header.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll('.reveal').forEach((element, index) => {
  element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
  observer.observe(element);
});

const repoUrl = document.querySelector('meta[name="repository"]')?.content;
if (repoUrl) {
  document.querySelectorAll('[data-repo-link]').forEach((link) => {
    link.href = repoUrl;
  });
}

const queryText = document.querySelector('.query-text');
const phrases = ['latest space discoveries', 'new AI safety research', 'weather this weekend'];
let phraseIndex = 0;
setInterval(() => {
  phraseIndex = (phraseIndex + 1) % phrases.length;
  if (queryText) queryText.textContent = phrases[phraseIndex];
}, 3200);
