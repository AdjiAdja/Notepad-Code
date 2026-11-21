// Latar: hitam (default, seperti gambar referensi), langit (hills.jpg), shenzhen (video, tidak di-autoplay bila reduce-motion).
import { h } from './util.js';
export const BGS = ['hitam', 'langit', 'shenzhen'];
export function applyBg(name) {
  const b = BGS.includes(name) ? name : 'hitam';
  document.body.dataset.bg = b;
  document.getElementById('bgv')?.remove();
  if (b === 'shenzhen' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const v = h('video', { id: 'bgv', src: 'assets/media/shenzhen.mp4', poster: 'assets/media/hills.jpg', muted: true, loop: true, autoplay: true, playsinline: true, 'aria-hidden': 'true', tabindex: '-1' });
    v.muted = true;
    document.body.prepend(v);
    v.play?.().catch(() => {});
  }
}
