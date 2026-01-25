'use client';

import { useState, useEffect } from 'react';
import {
  Carrier,
  getCarriers,
  createCarrier,
  updateCarrier,
  deleteCarrier,
  getOrganizations,
  OrganizationDetails,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function CarriersPage() {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationDetails[]>([]);
  const [selectedCarrier, setSelectedCarrier] = useState<Carrier | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [newCarrier, setNewCarrier] = useState({
    scacCode: '',
    name: '',
  });

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editCarrier, setEditCarrier] = useState({
    scacCode: '',
    name: '',
  });

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Messages
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      const [carriersRes, orgsRes] = await Promise.all([
        getCarriers(),
        getOrganizations(),
      ]);

      if (!isMounted) return;

      if (carriersRes.success && carriersRes.data) {
        setCarriers(carriersRes.data);
      }
      if (orgsRes.success && orgsRes.data) {
        setOrganizations(orgsRes.data);
      }
      setIsLoading(false);
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredCarriers = carriers.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.scacCode.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Check if user is admin of any org (carriers are global, so any admin can manage)
  const canManageCarriers = organizations.some(o => ['OWNER', 'ADMIN'].includes(o.role));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCarrier.name.trim() || !newCarrier.scacCode.trim()) return;

    setCreateSubmitting(true);
    const response = await createCarrier({
      scacCode: newCarrier.scacCode.trim().toUpperCase(),
      name: newCarrier.name.trim(),
    });

    if (response.success && response.data) {
      setCarriers((prev) => [...prev, response.data!].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedCarrier(response.data);
      setShowCreateModal(false);
      setNewCarrier({ scacCode: '', name: '' });
      setMessage({ type: 'success', text: 'Carrier created successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to create carrier' });
    }
    setCreateSubmitting(false);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarrier || !editCarrier.name.trim() || !editCarrier.scacCode.trim()) return;

    setEditSubmitting(true);
    const response = await updateCarrier(selectedCarrier.id, {
      scacCode: editCarrier.scacCode.trim().toUpperCase(),
      name: editCarrier.name.trim(),
    });

    if (response.success && response.data) {
      setCarriers((prev) =>
        prev.map((c) => (c.id === selectedCarrier.id ? response.data! : c)).sort((a, b) => a.name.localeCompare(b.name))
      );
      setSelectedCarrier(response.data);
      setShowEditModal(false);
      setMessage({ type: 'success', text: 'Carrier updated successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to update carrier' });
    }
    setEditSubmitting(false);
  };

  const handleDelete = async () => {
    if (!selectedCarrier) return;

    setDeleteSubmitting(true);
    const response = await deleteCarrier(selectedCarrier.id);

    if (response.success) {
      setCarriers((prev) => prev.filter((c) => c.id !== selectedCarrier.id));
      setSelectedCarrier(null);
      setShowDeleteConfirm(false);
      setMessage({ type: 'success', text: 'Carrier deleted successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to delete carrier' });
    }
    setDeleteSubmitting(false);
  };

  const openEditModal = () => {
    if (!selectedCarrier) return;
    setEditCarrier({
      scacCode: selectedCarrier.scacCode,
      name: selectedCarrier.name,
    });
    setShowEditModal(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Carriers</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Manage shipping carriers and their SCAC codes
          </p>
        </div>
        {canManageCarriers && (
          <Button onClick={() => setShowCreateModal(true)}>
            <svg className="size-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Carrier
          </Button>
        )}
      </div>

      {message && (
        <div
          className={`p-3 rounded-md text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {message.text}
          <button onClick={() => setMessage(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Carrier List */}
        <div className="space-y-4">
          <div>
            <Input
              placeholder="Search carriers or SCAC codes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {filteredCarriers.length} Carrier{filteredCarriers.length !== 1 ? 's' : ''}
          </h3>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filteredCarriers.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-gray-500">No carriers found</p>
                  {canManageCarriers && (
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setShowCreateModal(true)}
                    >
                      Add your first carrier
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              filteredCarriers.map((carrier) => (
                <button
                  key={carrier.id}
                  onClick={() => setSelectedCarrier(carrier)}
                  className={`w-full text-left p-4 rounded-lg border transition-colors ${
                    selectedCarrier?.id === carrier.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-white">
                        {carrier.scacCode.slice(0, 2)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{carrier.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        <span className="font-mono">{carrier.scacCode}</span> &middot; {carrier.totalShipments} shipments
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Carrier Details */}
        <div className="lg:col-span-2 space-y-6">
          {selectedCarrier ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-3">
                      <div className="size-12 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                        <span className="text-sm font-bold text-white">
                          {selectedCarrier.scacCode.slice(0, 2)}
                        </span>
                      </div>
                      {selectedCarrier.name}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      Shipping carrier with SCAC code <span className="font-mono font-medium">{selectedCarrier.scacCode}</span>
                    </CardDescription>
                  </div>
                  {canManageCarriers && (
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={openEditModal}>Edit</Button>
                      <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>Delete</Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-gray-500">SCAC Code</Label>
                      <p className="text-2xl font-mono font-bold text-gray-900 dark:text-white">
                        {selectedCarrier.scacCode}
                      </p>
                      <p className="text-xs text-gray-500">
                        Standard Carrier Alpha Code
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-gray-500">Total Shipments</Label>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {selectedCarrier.totalShipments.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500">
                        Shipments handled by this carrier
                      </p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Created</Label>
                      <p className="font-medium">
                        {new Date(selectedCarrier.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Last Updated</Label>
                      <p className="font-medium">
                        {new Date(selectedCarrier.updatedAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* SCAC Code Info */}
              <Card>
                <CardHeader>
                  <CardTitle>About SCAC Codes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <p className="text-gray-600 dark:text-gray-400">
                      The Standard Carrier Alpha Code (SCAC) is a unique two-to-four letter code used to identify
                      transportation companies. SCAC codes are assigned by the National Motor Freight Traffic
                      Association (NMFTA) and are required for doing business with U.S. government agencies.
                    </p>
                    <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        This carrier&apos;s SCAC: <span className="font-mono text-blue-600 dark:text-blue-400">{selectedCarrier.scacCode}</span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                </svg>
                <p className="mt-4 text-gray-500">Select a carrier to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Add Carrier</CardTitle>
              <CardDescription>Add a new shipping carrier</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="createScac">SCAC Code *</Label>
                  <Input
                    id="createScac"
                    value={newCarrier.scacCode}
                    onChange={(e) => setNewCarrier({ ...newCarrier, scacCode: e.target.value.toUpperCase() })}
                    placeholder="MAEU"
                    maxLength={4}
                    className="font-mono uppercase"
                    required
                  />
                  <p className="text-xs text-gray-500">2-4 letter Standard Carrier Alpha Code</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="createName">Carrier Name *</Label>
                  <Input
                    id="createName"
                    value={newCarrier.name}
                    onChange={(e) => setNewCarrier({ ...newCarrier, name: e.target.value })}
                    placeholder="Maersk Line"
                    required
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSubmitting}>
                    {createSubmitting ? 'Creating...' : 'Create Carrier'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Edit Carrier</CardTitle>
              <CardDescription>Update carrier information</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEdit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="editScac">SCAC Code *</Label>
                  <Input
                    id="editScac"
                    value={editCarrier.scacCode}
                    onChange={(e) => setEditCarrier({ ...editCarrier, scacCode: e.target.value.toUpperCase() })}
                    maxLength={4}
                    className="font-mono uppercase"
                    required
                  />
                  <p className="text-xs text-gray-500">2-4 letter Standard Carrier Alpha Code</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editName">Carrier Name *</Label>
                  <Input
                    id="editName"
                    value={editCarrier.name}
                    onChange={(e) => setEditCarrier({ ...editCarrier, name: e.target.value })}
                    required
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editSubmitting}>
                    {editSubmitting ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4 border-red-200 dark:border-red-900">
            <CardHeader>
              <CardTitle className="text-red-600">Delete Carrier</CardTitle>
              <CardDescription>
                This action cannot be undone. This will permanently delete {selectedCarrier?.name} ({selectedCarrier?.scacCode}).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleteSubmitting}>
                  {deleteSubmitting ? 'Deleting...' : 'Delete Carrier'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
