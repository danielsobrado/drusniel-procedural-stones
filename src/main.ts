import './styles/app.css';
import './styles/refinements.css';
import './styles/library-compact.css';
import './styles/brand.css';
import './styles/marble-glass.css';
import './styles/status-badge.css';
import './styles/stone-lab.css';
import { App } from './app/App';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('Application root was not found.');
}

new App(root);

const splash = document.getElementById('boot-splash');
if (splash !== null) {
  splash.setAttribute('data-state', 'done');
  const reduced =
    window.matchMedia !== undefined &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(
    () => {
      splash.remove();
    },
    reduced ? 0 : 280
  );
}
