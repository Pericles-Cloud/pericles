---
paths:
  - "frontend/**/*.tsx"
  - "frontend/**/*.ts"
  - "packages/web/**/*.tsx"
  - "packages/web/**/*.ts"
---

# Frontend Standards (React/Next.js/Tailwind)

## React Component Pattern

```typescript
import React from 'react';

interface UserProfileProps {
  user: User;
  onEdit?: (user: User) => void;
  className?: string;
}

export const UserProfile: React.FC<UserProfileProps> = ({
  user,
  onEdit,
  className = '',
}) => {
  const handleEdit = () => onEdit?.(user);

  return (
    <div className={`user-profile ${className}`}>
      <h3>{user.name}</h3>
      <p>{user.email}</p>
      {onEdit && (
        <button onClick={handleEdit} type="button">
          Edit
        </button>
      )}
    </div>
  );
};
```

## React Hooks Best Practices

- Use functional components with hooks (no class components)
- Explicit TypeScript types for all props and state
- Memoize expensive computations with `useMemo`
- Stabilize callbacks with `useCallback`
- Use `React.memo` for components with expensive renders

```typescript
const filteredEvents = useMemo(() =>
  events.filter(e => e.severity > threshold),
  [events, threshold]
);

const handleEventClick = useCallback((eventId: string) => {
  onSelect(eventId);
}, [onSelect]);
```

## Tailwind CSS Standards

### Class Ordering
Layout → Flexbox/Grid → Spacing → Sizing → Typography → Colors → Borders → Effects

```tsx
<div className="relative flex items-center justify-between w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
  {/* Content */}
</div>
```

### Mobile-First Responsive
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 sm:p-6 lg:p-8">
  {/* Cards */}
</div>
```

## shadcn/ui Components

Install via CLI:
```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card input dialog
```

Import from local ui folder:
```typescript
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
```

## Next.js App Router

```typescript
// app/events/page.tsx (Server Component)
export default async function EventsPage() {
  const events = await fetchEvents();
  return <EventList events={events} />;
}

// components/EventActions.tsx (Client Component)
'use client';

export function EventActions({ eventId }: { eventId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  // Interactive logic
}
```

## Accessibility Requirements

- Proper focus states on all interactive elements
- `aria-` attributes preserved from shadcn/ui
- Keyboard navigation (Tab, Enter, Escape)
- Color contrast meeting WCAG 2.1 AA
- Screen reader support with semantic HTML
