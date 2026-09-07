'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Supports multiple paragraphs — pass a fragment of <p> elements for longer warnings. */
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 'destructive' for irreversible/high-stakes actions (red accent, red confirm button). */
  variant?: 'destructive' | 'default';
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Branded stand-in for `window.confirm()`. Mirrors the existing "Delete
 * Organization" modal (manage/organizations/page.tsx) so every consequential
 * action gets the same in-app look instead of a native browser dialog.
 *
 * Introduced to close the confirmation gap flagged by /impeccable critique
 * (P0: the workflow editor's "Run" button had no confirmation at all, and the
 * Plans list view's equivalent used a native `window.confirm`; P1: "Leave
 * Organization" had none). Both now render this component instead.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'destructive',
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Escape cancels, matching the sidebar's existing modal-drawer behavior.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <Card className={`w-full max-w-md mx-4 ${variant === 'destructive' ? 'border-risk-critical-accent/40' : ''}`}>
        <CardHeader>
          <CardTitle id="confirm-dialog-title" className={variant === 'destructive' ? 'text-risk-critical-text' : ''}>
            {title}
          </CardTitle>
          <CardDescription id="confirm-dialog-description" className="space-y-2">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onCancel} disabled={isConfirming}>
              {cancelLabel}
            </Button>
            <Button variant={variant} onClick={onConfirm} disabled={isConfirming} autoFocus>
              {isConfirming ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
