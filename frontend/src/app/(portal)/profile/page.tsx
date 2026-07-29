'use client';

import { useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { updateProfile } from '@/lib/api-client';
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

export default function ProfilePage() {
  const { user, organizations, currentOrganization, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    const response = await updateProfile({ name: name || undefined });

    if (response.success) {
      await refreshUser();
      setMessage({ type: 'success', text: 'Profile updated successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to update profile' });
    }

    setIsSubmitting(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl font-semibold text-foreground">Profile</h2>
        <Fillet className="my-2" />
        <p className="text-muted-foreground">
          Manage your account information
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {message && (
                  <div
                    className={`p-3 rounded-md text-sm ${
                      message.type === 'success'
                        ? 'bg-risk-low text-risk-low-fg'
                        : 'bg-risk-critical text-risk-critical-fg'
                    }`}
                  >
                    {message.text}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Display Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                  />
                </div>

                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account Status</CardTitle>
              <CardDescription>Your account verification status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div className="flex items-center gap-3">
                  <div className={`size-3 rounded-full ${user?.emailVerified ? 'bg-risk-low-accent' : 'bg-risk-elevated-accent'}`} />
                  <div>
                    <p className="font-medium">Email Verification</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                </div>
                <span className={`text-sm font-medium ${user?.emailVerified ? 'text-risk-low-text' : 'text-risk-elevated-text'}`}>
                  {user?.emailVerified ? 'Verified' : 'Pending'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Picture</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <div className="size-24 rounded-full bg-primary flex items-center justify-center">
                <span className="text-3xl font-bold text-primary-foreground">
                  {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Profile pictures are generated from your initials
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organizations</CardTitle>
              <CardDescription>Your organization memberships</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {organizations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No organizations</p>
              ) : (
                organizations.map((org) => (
                  <div
                    key={org.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      currentOrganization?.id === org.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border'
                    }`}
                  >
                    <div className="size-10 rounded-full bg-risk-monitoring flex items-center justify-center">
                      <span className="text-sm font-bold text-risk-monitoring-fg">
                        {org.name[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{org.name}</p>
                      <p className="text-xs text-muted-foreground">{org.role}</p>
                    </div>
                    {currentOrganization?.id === org.id && (
                      <span className="text-xs text-primary font-medium">Current</span>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
