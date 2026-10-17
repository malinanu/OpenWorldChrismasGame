import type { WebGLRenderer } from 'three';

/**
 * Optional performance overlay (FPS, CPU and GPU time) via stats-gl.
 * Off by default; open the game with `?stats` in the URL to see it — handy when
 * testing on a real phone. Loaded lazily so normal players never download it.
 */
export async function maybeShowStats(renderer: WebGLRenderer): Promise<(() => void) | null> {
  if (!new URLSearchParams(location.search).has('stats')) return null;
  const { default: Stats } = await import('stats-gl');
  const stats = new Stats({ trackGPU: true, horizontal: true });
  // Panels hang off a zero-size anchor; park it under the ornament tracker.
  stats.dom.style.top = 'calc(64px + env(safe-area-inset-top, 0px))';
  stats.dom.style.left = 'calc(10px + env(safe-area-inset-left, 0px))';
  document.body.appendChild(stats.dom);
  await stats.init(renderer);
  return () => stats.update();
}
