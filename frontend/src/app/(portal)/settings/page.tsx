'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { useAuth } from '@/providers/auth-provider';
import { useMounted } from '@/lib/use-mounted';
import { updatePassword, deleteAccount } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Fillet } from '@/components/ui/fillet';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Literal light/dark previews — ramp colours, not role tokens. */
const THEME_OPTIONS = [
  { value: 'light', label: 'Light', swatch: 'bg-grey-50' },
  { value: 'dark', label: 'Dark', swatch: 'bg-grey-900' },
  { value: 'system', label: 'System', swatch: 'bg-gradient-to-r from-grey-50 to-grey-900' },
] as const;

export default function SettingsPage() {
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  // theme is undefined server-side; without this the selected option would
  // differ between server and client markup.
  const mounted = useMounted();

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    setPasswordSubmitting(true);

    const response = await updatePassword({
      currentPassword,
      newPassword,
    });

    if (response.success) {
      setPasswordMessage({ type: 'success', text: 'Password updated successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setPasswordMessage({ type: 'error', text: response.error?.message || 'Failed to update password' });
    }

    setPasswordSubmitting(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;

    setDeleteSubmitting(true);

    const response = await deleteAccount();

    if (response.success) {
      await logout();
    } else {
      setDeleteSubmitting(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl font-semibold text-foreground">Settings</h2>
        <Fillet className="my-2" />
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Update your account password</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {passwordMessage && (
                <div
                  className={`p-3 rounded-md text-sm ${
                    passwordMessage.type === 'success'
                      ? 'bg-risk-low text-risk-low-fg'
                      : 'bg-risk-critical text-risk-critical-fg'
                  }`}
                >
                  {passwordMessage.text}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                  minLength={8}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                />
              </div>

              <Button type="submit" disabled={passwordSubmitting}>
                {passwordSubmitting ? 'Updating...' : 'Update Password'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Configure how you receive notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">Receive email alerts for critical events</p>
              </div>
              <button
                type="button"
                className="relative inline-flex h-6 w-11 items-center rounded-full border border-primary bg-primary transition-colors"
                role="switch"
                aria-checked="true"
              >
                <span className="inline-block size-4 translate-x-6 transform rounded-full bg-primary-foreground transition-transform" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Weekly Digest</p>
                <p className="text-sm text-muted-foreground">Receive a weekly summary of events</p>
              </div>
              <button
                type="button"
                className="relative inline-flex h-6 w-11 items-center rounded-full bg-muted border border-muted-foreground/70 transition-colors"
                role="switch"
                aria-checked="false"
              >
                <span className="inline-block size-4 translate-x-1 transform rounded-full bg-muted-foreground transition-transform" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Push Notifications</p>
                <p className="text-sm text-muted-foreground">Browser push notifications for real-time alerts</p>
              </div>
              <button
                type="button"
                className="relative inline-flex h-6 w-11 items-center rounded-full bg-muted border border-muted-foreground/70 transition-colors"
                role="switch"
                aria-checked="false"
              >
                <span className="inline-block size-4 translate-x-1 transform rounded-full bg-muted-foreground transition-transform" />
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Customize the look and feel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="mb-3 block">Theme</Label>
              {/* Wired to the same next-themes store as the header toggle, so
                  the two can't disagree. The swatches are literal light/dark
                  previews, so they use the ramp, not role tokens. */}
              <div className="flex gap-3">
                {THEME_OPTIONS.map(({ value, label, swatch }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    aria-pressed={mounted && theme === value}
                    className={`flex-1 rounded-lg p-3 text-center transition-colors pointer-coarse:min-h-11 ${
                      mounted && theme === value
                        // border-2 on BOTH: switching selection must not change
                        // the border width, or the row shifts by 1px.
                        ? 'border-2 border-primary bg-primary/10'
                        : 'border-2 border-border bg-card hover:bg-accent'
                    }`}
                  >
                    <div className={`mx-auto mb-2 size-8 rounded border border-grey-300 ${swatch}`} />
                    <span className="text-sm font-medium text-foreground">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-risk-critical-accent/40">
          <CardHeader>
            <CardTitle className="text-risk-critical-text">Danger Zone</CardTitle>
            <CardDescription>Irreversible actions for your account</CardDescription>
          </CardHeader>
          <CardContent>
            {!showDeleteConfirm ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Delete Account</p>
                  <p className="text-sm text-muted-foreground">Permanently delete your account and all data</p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete Account
                </Button>
              </div>
            ) : (
              <div className="space-y-4 p-4 bg-risk-critical rounded-lg">
                <div className="flex items-start gap-3">
                  <svg
                    className="size-6 text-risk-critical-fg shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                  <div>
                    <p className="font-medium text-risk-critical-fg">
                      This action cannot be undone
                    </p>
                    <p className="text-sm text-risk-critical-fg mt-1">
                      This will permanently delete your account, remove your data, and revoke access to all organizations.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="deleteConfirm" className="text-risk-critical-fg">
                    Type DELETE to confirm
                  </Label>
                  <Input
                    id="deleteConfirm"
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="border-risk-critical-accent/40"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== 'DELETE' || deleteSubmitting}
                  >
                    {deleteSubmitting ? 'Deleting...' : 'Permanently Delete Account'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
