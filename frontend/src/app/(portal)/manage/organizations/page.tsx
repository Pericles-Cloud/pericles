'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  Organization,
  OrganizationDetails,
  OrganizationMember,
  OrganizationInvite,
  getOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getOrganizationMembers,
  getOrganizationInvites,
  inviteMember,
  cancelInvite,
  removeMember,
  updateMemberRole,
  leaveOrganization,
} from '@/lib/api-client';
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

type RoleType = 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';

export default function OrganizationsPage() {
  const { currentOrganization, setCurrentOrganization, refreshUser } = useAuth();

  const [organizations, setOrganizations] = useState<OrganizationDetails[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationDetails | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invites, setInvites] = useState<OrganizationInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create org modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Edit org modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editOrgName, setEditOrgName] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER' | 'GUEST'>('MEMBER');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Error/success messages
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      const response = await getOrganizations();
      if (!isMounted) return;

      if (response.success && response.data) {
        setOrganizations(response.data);
        if (response.data.length > 0) {
          const current = response.data.find((o) => o.id === currentOrganization?.id);
          setSelectedOrg(current || response.data[0]);
        }
      }
      setIsLoading(false);
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id]);

  useEffect(() => {
    if (!selectedOrg) return;

    let isMounted = true;
    const orgId = selectedOrg.id;

    const fetchDetails = async () => {
      const [membersRes, invitesRes] = await Promise.all([
        getOrganizationMembers(orgId),
        getOrganizationInvites(orgId),
      ]);

      if (!isMounted) return;

      if (membersRes.success && membersRes.data) {
        setMembers(membersRes.data);
      }
      if (invitesRes.success && invitesRes.data) {
        setInvites(invitesRes.data);
      }
    };

    fetchDetails();

    return () => {
      isMounted = false;
    };
  }, [selectedOrg]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;

    setCreateSubmitting(true);
    const response = await createOrganization({ name: newOrgName.trim() });

    if (response.success && response.data) {
      setOrganizations((prev) => [...prev, response.data!]);
      setSelectedOrg(response.data);
      setShowCreateModal(false);
      setNewOrgName('');
      setMessage({ type: 'success', text: 'Organization created successfully' });
      await refreshUser();
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to create organization' });
    }
    setCreateSubmitting(false);
  };

  const handleEditOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg || !editOrgName.trim()) return;

    setEditSubmitting(true);
    const response = await updateOrganization(selectedOrg.id, { name: editOrgName.trim() });

    if (response.success && response.data) {
      setOrganizations((prev) =>
        prev.map((o) => (o.id === selectedOrg.id ? response.data! : o))
      );
      setSelectedOrg(response.data);
      setShowEditModal(false);
      setMessage({ type: 'success', text: 'Organization updated successfully' });
      await refreshUser();
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to update organization' });
    }
    setEditSubmitting(false);
  };

  const handleDeleteOrg = async () => {
    if (!selectedOrg) return;

    setDeleteSubmitting(true);
    const response = await deleteOrganization(selectedOrg.id);

    if (response.success) {
      setOrganizations((prev) => prev.filter((o) => o.id !== selectedOrg.id));
      setSelectedOrg(organizations.find((o) => o.id !== selectedOrg.id) || null);
      setShowDeleteConfirm(false);
      setMessage({ type: 'success', text: 'Organization deleted successfully' });
      await refreshUser();
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to delete organization' });
    }
    setDeleteSubmitting(false);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg || !inviteEmail.trim()) return;

    setInviteSubmitting(true);
    const response = await inviteMember(selectedOrg.id, {
      email: inviteEmail.trim(),
      role: inviteRole,
    });

    if (response.success && response.data) {
      setInvites((prev) => [...prev, response.data!]);
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      setMessage({ type: 'success', text: 'Invitation sent successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to send invitation' });
    }
    setInviteSubmitting(false);
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!selectedOrg) return;

    const response = await cancelInvite(selectedOrg.id, inviteId);
    if (response.success) {
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      setMessage({ type: 'success', text: 'Invitation cancelled' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to cancel invitation' });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!selectedOrg) return;

    const response = await removeMember(selectedOrg.id, memberId);
    if (response.success) {
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      setMessage({ type: 'success', text: 'Member removed' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to remove member' });
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST') => {
    if (!selectedOrg) return;

    const response = await updateMemberRole(selectedOrg.id, memberId, newRole);
    if (response.success && response.data) {
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? response.data! : m))
      );
      setMessage({ type: 'success', text: 'Role updated' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to update role' });
    }
  };

  const handleLeaveOrg = async () => {
    if (!selectedOrg) return;

    const response = await leaveOrganization(selectedOrg.id);
    if (response.success) {
      setOrganizations((prev) => prev.filter((o) => o.id !== selectedOrg.id));
      setSelectedOrg(organizations.find((o) => o.id !== selectedOrg.id) || null);
      setMessage({ type: 'success', text: 'You have left the organization' });
      await refreshUser();
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to leave organization' });
    }
  };

  const handleSwitchOrg = (org: Organization) => {
    setCurrentOrganization(org);
    setMessage({ type: 'success', text: `Switched to ${org.name}` });
  };

  const getUserRole = (orgId: string): RoleType | null => {
    const org = organizations.find((o) => o.id === orgId);
    return org?.role || null;
  };

  const canManageOrg = selectedOrg && ['OWNER', 'ADMIN'].includes(getUserRole(selectedOrg.id) || '');
  const isOwner = selectedOrg && getUserRole(selectedOrg.id) === 'OWNER';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-3xl font-semibold text-foreground">Organizations</h2>
          <Fillet className="my-2" />
          <p className="text-muted-foreground">
            Manage your organizations and team members
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <svg className="size-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Organization
        </Button>
      </div>

      {message && (
        <div
          className={`p-3 rounded-md text-sm ${
            message.type === 'success'
              ? 'bg-risk-low text-risk-low-fg'
              : 'bg-risk-critical text-risk-critical-fg'
          }`}
        >
          {message.text}
          <button
            onClick={() => setMessage(null)}
            className="float-right font-bold"
          >
            &times;
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Organization List */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Your Organizations
          </h3>
          <div className="space-y-2">
            {organizations.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">No organizations yet</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create your first organization
                  </Button>
                </CardContent>
              </Card>
            ) : (
              organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => setSelectedOrg(org)}
                  className={`w-full text-left p-4 rounded-lg border transition-colors ${
                    selectedOrg?.id === org.id
                      ? 'border-primary bg-primary/10'
                      // bg-muted, not bg-accent: the row's own sub-labels are
                      // `text-muted-foreground`, which is 2.7:1 on --accent in
                      // dark mode but 4.9:1 on --muted.
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary-foreground">
                        {org.name[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{org.name}</p>
                      <p className="text-xs text-muted-foreground">{org.role}</p>
                    </div>
                    {currentOrganization?.id === org.id && (
                      <span className="text-xs bg-risk-monitoring text-risk-monitoring-fg px-2 py-1 rounded">
                        Active
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Organization Details */}
        <div className="lg:col-span-2 space-y-6">
          {selectedOrg ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-3">
                      <div className="size-12 rounded-full bg-primary flex items-center justify-center">
                        <span className="text-lg font-bold text-primary-foreground">
                          {selectedOrg.name[0].toUpperCase()}
                        </span>
                      </div>
                      {selectedOrg.name}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      {members.length} member{members.length !== 1 ? 's' : ''} &middot; Your role: {getUserRole(selectedOrg.id)}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {currentOrganization?.id !== selectedOrg.id && (
                      <Button variant="outline" onClick={() => handleSwitchOrg(selectedOrg)}>
                        Switch to this
                      </Button>
                    )}
                    {canManageOrg && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditOrgName(selectedOrg.name);
                          setShowEditModal(true);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                </CardHeader>
              </Card>

              {/* Members Section */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Members</CardTitle>
                    <CardDescription>People with access to this organization</CardDescription>
                  </div>
                  {canManageOrg && (
                    <Button onClick={() => setShowInviteModal(true)}>
                      <svg className="size-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                      </svg>
                      Invite
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted"
                      >
                        <div className="flex items-center gap-3">
                          <div className="size-10 rounded-full bg-muted-foreground/20 flex items-center justify-center">
                            <span className="text-sm font-medium text-muted-foreground">
                              {member.user.name?.[0]?.toUpperCase() || member.user.email[0].toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium">{member.user.name || member.user.email}</p>
                            <p className="text-sm text-muted-foreground">{member.user.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {canManageOrg && member.role !== 'OWNER' ? (
                            <select
                              value={member.role}
                              onChange={(e) => handleUpdateRole(member.id, e.target.value as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST')}
                              className="text-sm border rounded-md px-2 py-1 bg-card"
                            >
                              {isOwner && <option value="OWNER">Owner</option>}
                              <option value="ADMIN">Admin</option>
                              <option value="MEMBER">Member</option>
                              <option value="GUEST">Guest</option>
                            </select>
                          ) : (
                            <span className={`text-sm px-2 py-1 rounded ${
                              member.role === 'OWNER'
                                ? 'bg-primary/10 text-primary'
                                : 'bg-muted text-foreground'
                            }`}>
                              {member.role}
                            </span>
                          )}
                          {canManageOrg && member.role !== 'OWNER' && (
                            <button
                              onClick={() => handleRemoveMember(member.id)}
                              className="text-risk-critical-text hover:bg-risk-critical hover:text-risk-critical-fg"
                            >
                              <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Pending Invites */}
              {canManageOrg && invites.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Pending Invitations</CardTitle>
                    <CardDescription>Invitations waiting to be accepted</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {invites.filter(i => i.status === 'PENDING').map((invite) => (
                        <div
                          key={invite.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-risk-elevated"
                        >
                          <div>
                            <p className="font-medium">{invite.email}</p>
                            <p className="text-sm text-muted-foreground">
                              Invited as {invite.role} &middot; Expires {new Date(invite.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancelInvite(invite.id)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Danger Zone */}
              <Card className="border-risk-critical-accent/40">
                <CardHeader>
                  <CardTitle className="text-risk-critical-text">Danger Zone</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!isOwner && (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Leave Organization</p>
                        <p className="text-sm text-muted-foreground">Remove yourself from this organization</p>
                      </div>
                      <Button variant="outline" onClick={handleLeaveOrg}>
                        Leave
                      </Button>
                    </div>
                  )}
                  {isOwner && (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Delete Organization</p>
                        <p className="text-sm text-muted-foreground">Permanently delete this organization and all its data</p>
                      </div>
                      <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <svg className="mx-auto h-12 w-12 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                </svg>
                <p className="mt-4 text-muted-foreground">Select an organization to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create Organization Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Create Organization</CardTitle>
              <CardDescription>Create a new organization for your team</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateOrg} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Organization Name</Label>
                  <Input
                    id="orgName"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="Acme Inc."
                    required
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateModal(false);
                      setNewOrgName('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSubmitting}>
                    {createSubmitting ? 'Creating...' : 'Create'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Organization Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Edit Organization</CardTitle>
              <CardDescription>Update organization details</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEditOrg} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="editOrgName">Organization Name</Label>
                  <Input
                    id="editOrgName"
                    value={editOrgName}
                    onChange={(e) => setEditOrgName(e.target.value)}
                    required
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowEditModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editSubmitting}>
                    {editSubmitting ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Invite Member</CardTitle>
              <CardDescription>Send an invitation to join {selectedOrg?.name}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="inviteEmail">Email Address</Label>
                  <Input
                    id="inviteEmail"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inviteRole">Role</Label>
                  <select
                    id="inviteRole"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'ADMIN' | 'MEMBER' | 'GUEST')}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  >
                    <option value="ADMIN">Admin - Can manage members and settings</option>
                    <option value="MEMBER">Member - Full access to features</option>
                    <option value="GUEST">Guest - Limited read-only access</option>
                  </select>
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowInviteModal(false);
                      setInviteEmail('');
                      setInviteRole('MEMBER');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={inviteSubmitting}>
                    {inviteSubmitting ? 'Sending...' : 'Send Invite'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4 border-risk-critical-accent/40">
            <CardHeader>
              <CardTitle className="text-risk-critical-text">Delete Organization</CardTitle>
              <CardDescription>
                This action cannot be undone. This will permanently delete {selectedOrg?.name} and remove all associated data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteOrg}
                  disabled={deleteSubmitting}
                >
                  {deleteSubmitting ? 'Deleting...' : 'Delete Organization'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
