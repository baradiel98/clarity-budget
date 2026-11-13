import { motion } from '@clarity/design-system';

/** True when the person asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How long an exit animation runs before the element is removed (0 with reduced motion). */
export function exitMs(): number {
  return prefersReducedMotion() ? 0 : motion.fast;
}
