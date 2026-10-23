import { useEffect, useState } from 'react';

const read = () => {
  try {
    return localStorage.getItem('theme') ?? 'system';
  } catch {
    return 'system';
  }
};

export default function ThemeToggle() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // storage unavailable: preference lasts for this page only
    }
  }, [theme]);
  return (
    <label className="small">
      <span className="sr-only" style={{ position: 'absolute', left: -9999 }}>
        Theme
      </span>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        aria-label="Colour theme"
        style={{ minHeight: 30, padding: '2px 6px' }}
      >
        <option value="system">System theme</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
