// frontend/src/components/ui/fillet.tsx
import * as React from 'react';

import { cn } from '@/lib/utils';

interface FilletProps {
  /** 'horizontal' under a section head; 'vertical' as an active-state rule. */
  orientation?: 'horizontal' | 'vertical';
  /**
   * `shell` = on the app chrome, `content` = on the page canvas.
   *
   * Both are role tokens, not fixed ramp steps, because gold has to move in
   * the OPPOSITE direction to its backdrop: gold-800 on the light shell
   * (6.11:1) but gold-300 on the dark one (5.02:1). A single hardcoded gold
   * fails AA in one mode or the other.
   */
  tone?: 'content' | 'shell';
  className?: string;
}

/**
 * The Pericles fillet — a 2px gold rule above a 1px gold rule at 50% opacity.
 *
 * This is the brand's signature device. It marks section heads, card headers,
 * and the active navigation item. The active-item fill is near-invisible in
 * both modes (1.24:1 light, 1.67:1 dark — it is one ramp step from the shell),
 * so the fillet, not a background, is what carries the active nav state.
 * Purely decorative to assistive tech: aria-hidden.
 *
 * Use this component; do not re-hand-roll the divs.
 */
export const Fillet: React.FC<FilletProps> = ({
  orientation = 'horizontal',
  tone = 'content',
  className = '',
}) => {
  // --sidebar-fillet, not --sidebar-accent: the latter is shadcn's nav
  // hover/active surface and must keep that meaning.
  const bar = tone === 'shell' ? 'bg-sidebar-fillet' : 'bg-brand-accent';
  const isHorizontal = orientation === 'horizontal';

  return (
    <span
      aria-hidden
      className={cn(
        'flex',
        // The vertical variant sets NO height: callers position it (the nav
        // rule uses `absolute inset-y-1`). An `h-full` here would win over
        // `bottom` in the box model — and tailwind-merge won't drop it, since
        // height and inset are different conflict groups — so the rule would
        // overhang into the next item's gap. Vertical requires the parent to
        // supply height, via insets or a stretched flex parent.
        isHorizontal ? 'w-16 flex-col gap-[3px]' : 'flex-row gap-[3px]',
        className,
      )}
    >
      <span className={cn(bar, isHorizontal ? 'h-0.5 w-full' : 'w-0.5 self-stretch')} />
      <span
        className={cn(bar, 'opacity-50', isHorizontal ? 'h-px w-full' : 'w-px self-stretch')}
      />
    </span>
  );
};
