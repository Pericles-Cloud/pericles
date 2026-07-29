// frontend/src/components/layout/theme-toggle.tsx
'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useMounted } from '@/lib/use-mounted';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

interface ThemeToggleProps {
  className?: string;
}

/**
 * Light / Dark / System. Never force a mode — `system` is the default and has
 * to stay reachable, because a device-level preference is often an
 * accessibility setting rather than a taste one.
 *
 * Renders a stable placeholder until mounted: `theme` is undefined on the
 * server, so rendering the resolved icon directly causes a hydration mismatch.
 *
 * The 44px touch target comes from `buttonVariants`' own
 * `pointer-coarse:min-h-11 pointer-coarse:min-w-11`; it is NOT restated here.
 * Restating it unprefixed forced 44px on desktop too, where every other icon
 * button in the header is 36–40px, so the toggle sat visibly taller.
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const Active = OPTIONS.find((o) => o.value === theme)?.Icon ?? Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Change theme"
          className={className}
        >
          {mounted ? <Active className="size-4" aria-hidden /> : <span className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      {/* Radio group, not plain items: without it the menu never shows which
          theme is active, so a user can't tell System from Dark (the trigger
          icon resolves to Monitor for System either way). Radix supplies
          role="menuitemradio" + aria-checked, matching the Settings picker. */}
      <DropdownMenuContent align="end">
        {/* No `mounted` guard: DropdownMenuContent only renders once the menu
            is opened, which is always post-mount, and gating `value` would flip
            Radix between uncontrolled and controlled. */}
        <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="min-h-11 gap-2">
              <Icon className="size-4" aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
