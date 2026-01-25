'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  Supplier,
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
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

export default function SuppliersPage() {
  const { currentOrganization } = useAuth();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationDetails[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [newSupplier, setNewSupplier] = useState({
    organizationId: '',
    name: '',
    address: '',
    website: '',
    contactInfo: '',
    country: '',
    countryCode: '',
    notifyPartyName: '',
    notifyPartyAddress: '',
  });

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editSupplier, setEditSupplier] = useState({
    name: '',
    address: '',
    website: '',
    contactInfo: '',
    country: '',
    countryCode: '',
    notifyPartyName: '',
    notifyPartyAddress: '',
  });

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Messages
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      const [suppliersRes, orgsRes] = await Promise.all([
        getSuppliers(),
        getOrganizations(),
      ]);

      if (!isMounted) return;

      if (suppliersRes.success && suppliersRes.data) {
        setSuppliers(suppliersRes.data);
      }
      if (orgsRes.success && orgsRes.data) {
        setOrganizations(orgsRes.data);
        if (orgsRes.data.length > 0) {
          setNewSupplier((prev) => ({ ...prev, organizationId: currentOrganization?.id || orgsRes.data![0].id }));
        }
      }
      setIsLoading(false);
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id]);

  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.country?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.address?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getOrgName = (orgId: string) => {
    return organizations.find((o) => o.id === orgId)?.name || 'Unknown';
  };

  const canManageSupplier = (supplier: Supplier) => {
    const org = organizations.find((o) => o.id === supplier.organizationId);
    return org && ['OWNER', 'ADMIN'].includes(org.role);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplier.name.trim() || !newSupplier.organizationId) return;

    setCreateSubmitting(true);
    const response = await createSupplier({
      organizationId: newSupplier.organizationId,
      name: newSupplier.name.trim(),
      address: newSupplier.address || undefined,
      website: newSupplier.website || undefined,
      contactInfo: newSupplier.contactInfo || undefined,
      country: newSupplier.country || undefined,
      countryCode: newSupplier.countryCode || undefined,
      notifyPartyName: newSupplier.notifyPartyName || undefined,
      notifyPartyAddress: newSupplier.notifyPartyAddress || undefined,
    });

    if (response.success && response.data) {
      setSuppliers((prev) => [...prev, response.data!]);
      setSelectedSupplier(response.data);
      setShowCreateModal(false);
      setNewSupplier({
        organizationId: currentOrganization?.id || organizations[0]?.id || '',
        name: '',
        address: '',
        website: '',
        contactInfo: '',
        country: '',
        countryCode: '',
        notifyPartyName: '',
        notifyPartyAddress: '',
      });
      setMessage({ type: 'success', text: 'Supplier created successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to create supplier' });
    }
    setCreateSubmitting(false);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier || !editSupplier.name.trim()) return;

    setEditSubmitting(true);
    const response = await updateSupplier(selectedSupplier.id, {
      name: editSupplier.name.trim(),
      address: editSupplier.address || null,
      website: editSupplier.website || null,
      contactInfo: editSupplier.contactInfo || null,
      country: editSupplier.country || null,
      countryCode: editSupplier.countryCode || null,
      notifyPartyName: editSupplier.notifyPartyName || null,
      notifyPartyAddress: editSupplier.notifyPartyAddress || null,
    });

    if (response.success && response.data) {
      setSuppliers((prev) =>
        prev.map((s) => (s.id === selectedSupplier.id ? response.data! : s))
      );
      setSelectedSupplier(response.data);
      setShowEditModal(false);
      setMessage({ type: 'success', text: 'Supplier updated successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to update supplier' });
    }
    setEditSubmitting(false);
  };

  const handleDelete = async () => {
    if (!selectedSupplier) return;

    setDeleteSubmitting(true);
    const response = await deleteSupplier(selectedSupplier.id);

    if (response.success) {
      setSuppliers((prev) => prev.filter((s) => s.id !== selectedSupplier.id));
      setSelectedSupplier(null);
      setShowDeleteConfirm(false);
      setMessage({ type: 'success', text: 'Supplier deleted successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to delete supplier' });
    }
    setDeleteSubmitting(false);
  };

  const openEditModal = () => {
    if (!selectedSupplier) return;
    setEditSupplier({
      name: selectedSupplier.name,
      address: selectedSupplier.address || '',
      website: selectedSupplier.website || '',
      contactInfo: selectedSupplier.contactInfo || '',
      country: selectedSupplier.country || '',
      countryCode: selectedSupplier.countryCode || '',
      notifyPartyName: selectedSupplier.notifyPartyName || '',
      notifyPartyAddress: selectedSupplier.notifyPartyAddress || '',
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
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Suppliers</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Manage your supply chain suppliers
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <svg className="size-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Supplier
        </Button>
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
        {/* Supplier List */}
        <div className="space-y-4">
          <div>
            <Input
              placeholder="Search suppliers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {filteredSuppliers.length} Supplier{filteredSuppliers.length !== 1 ? 's' : ''}
          </h3>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filteredSuppliers.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-gray-500">No suppliers found</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Add your first supplier
                  </Button>
                </CardContent>
              </Card>
            ) : (
              filteredSuppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  onClick={() => setSelectedSupplier(supplier)}
                  className={`w-full text-left p-4 rounded-lg border transition-colors ${
                    selectedSupplier?.id === supplier.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-white">
                        {supplier.name[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{supplier.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {supplier.country || 'No location'} &middot; {supplier.totalShipments} shipments
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Supplier Details */}
        <div className="lg:col-span-2 space-y-6">
          {selectedSupplier ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-3">
                      <div className="size-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                        <span className="text-lg font-bold text-white">
                          {selectedSupplier.name[0].toUpperCase()}
                        </span>
                      </div>
                      {selectedSupplier.name}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      Organization: {getOrgName(selectedSupplier.organizationId)}
                    </CardDescription>
                  </div>
                  {canManageSupplier(selectedSupplier) && (
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={openEditModal}>Edit</Button>
                      <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>Delete</Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-gray-500">Country</Label>
                      <p className="font-medium">{selectedSupplier.country || '-'}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Country Code</Label>
                      <p className="font-medium">{selectedSupplier.countryCode || '-'}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-gray-500">Address</Label>
                      <p className="font-medium">{selectedSupplier.address || '-'}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Website</Label>
                      <p className="font-medium">
                        {selectedSupplier.website ? (
                          <a href={selectedSupplier.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            {selectedSupplier.website}
                          </a>
                        ) : '-'}
                      </p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Contact Info</Label>
                      <p className="font-medium">{selectedSupplier.contactInfo || '-'}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Total Shipments</Label>
                      <p className="font-medium">{selectedSupplier.totalShipments}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Coordinates</Label>
                      <p className="font-medium">
                        {selectedSupplier.latitude && selectedSupplier.longitude
                          ? `${selectedSupplier.latitude}, ${selectedSupplier.longitude}`
                          : '-'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Notify Party Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Notify Party</CardTitle>
                  <CardDescription>Contact for shipping notifications</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-gray-500">Name</Label>
                      <p className="font-medium">{selectedSupplier.notifyPartyName || '-'}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Address</Label>
                      <p className="font-medium">{selectedSupplier.notifyPartyAddress || '-'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Ports & HS Codes */}
              <Card>
                <CardHeader>
                  <CardTitle>Shipping Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4">
                    <div>
                      <Label className="text-gray-500">Departure Ports</Label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {selectedSupplier.departurePorts?.length ? (
                          selectedSupplier.departurePorts.map((port) => (
                            <span key={port} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-sm">
                              {port}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-gray-500">Destination Ports</Label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {selectedSupplier.destinationPorts?.length ? (
                          selectedSupplier.destinationPorts.map((port) => (
                            <span key={port} className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-sm">
                              {port}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-gray-500">HS Codes</Label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {selectedSupplier.hsCodes?.length ? (
                          selectedSupplier.hsCodes.map((code) => (
                            <span key={code} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-sm font-mono">
                              {code}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </div>
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
                <p className="mt-4 text-gray-500">Select a supplier to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Add Supplier</CardTitle>
              <CardDescription>Add a new supplier to your organization</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="createOrg">Organization</Label>
                  <select
                    id="createOrg"
                    value={newSupplier.organizationId}
                    onChange={(e) => setNewSupplier({ ...newSupplier, organizationId: e.target.value })}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    required
                  >
                    {organizations.filter(o => ['OWNER', 'ADMIN'].includes(o.role)).map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="createName">Supplier Name *</Label>
                  <Input
                    id="createName"
                    value={newSupplier.name}
                    onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                    placeholder="Acme Manufacturing"
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="createCountry">Country</Label>
                    <Input
                      id="createCountry"
                      value={newSupplier.country}
                      onChange={(e) => setNewSupplier({ ...newSupplier, country: e.target.value })}
                      placeholder="China"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createCountryCode">Country Code</Label>
                    <Input
                      id="createCountryCode"
                      value={newSupplier.countryCode}
                      onChange={(e) => setNewSupplier({ ...newSupplier, countryCode: e.target.value })}
                      placeholder="CN"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="createAddress">Address</Label>
                  <Input
                    id="createAddress"
                    value={newSupplier.address}
                    onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })}
                    placeholder="123 Industrial Zone, Shanghai"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="createWebsite">Website</Label>
                    <Input
                      id="createWebsite"
                      value={newSupplier.website}
                      onChange={(e) => setNewSupplier({ ...newSupplier, website: e.target.value })}
                      placeholder="https://example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createContact">Contact Info</Label>
                    <Input
                      id="createContact"
                      value={newSupplier.contactInfo}
                      onChange={(e) => setNewSupplier({ ...newSupplier, contactInfo: e.target.value })}
                      placeholder="contact@example.com"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="createNotifyName">Notify Party Name</Label>
                    <Input
                      id="createNotifyName"
                      value={newSupplier.notifyPartyName}
                      onChange={(e) => setNewSupplier({ ...newSupplier, notifyPartyName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createNotifyAddress">Notify Party Address</Label>
                    <Input
                      id="createNotifyAddress"
                      value={newSupplier.notifyPartyAddress}
                      onChange={(e) => setNewSupplier({ ...newSupplier, notifyPartyAddress: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSubmitting}>
                    {createSubmitting ? 'Creating...' : 'Create Supplier'}
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
          <Card className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Edit Supplier</CardTitle>
              <CardDescription>Update supplier information</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEdit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="editName">Supplier Name *</Label>
                  <Input
                    id="editName"
                    value={editSupplier.name}
                    onChange={(e) => setEditSupplier({ ...editSupplier, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editCountry">Country</Label>
                    <Input
                      id="editCountry"
                      value={editSupplier.country}
                      onChange={(e) => setEditSupplier({ ...editSupplier, country: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editCountryCode">Country Code</Label>
                    <Input
                      id="editCountryCode"
                      value={editSupplier.countryCode}
                      onChange={(e) => setEditSupplier({ ...editSupplier, countryCode: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editAddress">Address</Label>
                  <Input
                    id="editAddress"
                    value={editSupplier.address}
                    onChange={(e) => setEditSupplier({ ...editSupplier, address: e.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editWebsite">Website</Label>
                    <Input
                      id="editWebsite"
                      value={editSupplier.website}
                      onChange={(e) => setEditSupplier({ ...editSupplier, website: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editContact">Contact Info</Label>
                    <Input
                      id="editContact"
                      value={editSupplier.contactInfo}
                      onChange={(e) => setEditSupplier({ ...editSupplier, contactInfo: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editNotifyName">Notify Party Name</Label>
                    <Input
                      id="editNotifyName"
                      value={editSupplier.notifyPartyName}
                      onChange={(e) => setEditSupplier({ ...editSupplier, notifyPartyName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editNotifyAddress">Notify Party Address</Label>
                    <Input
                      id="editNotifyAddress"
                      value={editSupplier.notifyPartyAddress}
                      onChange={(e) => setEditSupplier({ ...editSupplier, notifyPartyAddress: e.target.value })}
                    />
                  </div>
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
              <CardTitle className="text-red-600">Delete Supplier</CardTitle>
              <CardDescription>
                This action cannot be undone. This will permanently delete {selectedSupplier?.name}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleteSubmitting}>
                  {deleteSubmitting ? 'Deleting...' : 'Delete Supplier'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
