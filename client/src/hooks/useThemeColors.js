import { useEffect, useState } from 'react';

const VARS = [
  '--series-1',
  '--series-2',
  '--series-3',
  '--series-4',
  '--grid',
  '--axis',
  '--muted',
  '--ink',
  '--ink-2',
  '--surface',
];

function read() {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(v).trim()]));
}

/** Resolved token values for SVG attributes (Recharts), refreshed on OS or in-app theme change. */
export function useThemeColors() {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const update = () => setColors(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', update);
      mo.disconnect();
    };
  }, []);
  return colors;
}
