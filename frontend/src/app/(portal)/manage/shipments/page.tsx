'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  Shipment,
  getShipments,
  createShipment,
  updateShipment,
  deleteShipment,
  getSuppliers,
  getCarriers,
  Supplier,
  Carrier,
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

export default function ShipmentsPage() {
  const { currentOrganization } = useAuth();

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [newShipment, setNewShipment] = useState({
    bolNumber: '',
    masterBolNumber: '',
    supplierId: '',
    carrierId: '',
    containersCount: '',
    valueUsd: '',
    arrivalDate: '',
    estimatedArrivalDate: '',
    destinationPort: '',
    departurePort: '',
    vesselName: '',
    voyage: '',
    productDescription: '',
  });

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editShipment, setEditShipment] = useState({
    bolNumber: '',
    masterBolNumber: '',
    supplierId: '',
    carrierId: '',
    containersCount: '',
    valueUsd: '',
    arrivalDate: '',
    estimatedArrivalDate: '',
    destinationPort: '',
    departurePort: '',
    vesselName: '',
    voyage: '',
    productDescription: '',
  });

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Messages
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!currentOrganization?.id) {
      return;
    }

    let isMounted = true;

    const fetchData = async () => {
      const [shipmentsRes, suppliersRes, carriersRes] = await Promise.all([
        getShipments(currentOrganization.id),
        getSuppliers(),
        getCarriers(),
      ]);

      if (!isMounted) return;

      if (shipmentsRes.success && shipmentsRes.data) {
        setShipments(shipmentsRes.data);
      }
      if (suppliersRes.success && suppliersRes.data) {
        setSuppliers(suppliersRes.data.filter(s => s.organizationId === currentOrganization.id));
      }
      if (carriersRes.success && carriersRes.data) {
        setCarriers(carriersRes.data);
      }
      setIsLoading(false);
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id]);

  // Handle case when organization is not yet loaded
  const isLoadingOrNoOrg = isLoading || !currentOrganization?.id;

  const filteredShipments = shipments.filter((s) =>
    s.bolNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.supplier?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.carrier?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.destinationPort?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.departurePort?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.vesselName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return '-';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganization?.id || !newShipment.bolNumber.trim()) return;

    setCreateSubmitting(true);
    const response = await createShipment({
      organizationId: currentOrganization.id,
      bolNumber: newShipment.bolNumber.trim(),
      masterBolNumber: newShipment.masterBolNumber || undefined,
      supplierId: newShipment.supplierId || undefined,
      carrierId: newShipment.carrierId || undefined,
      containersCount: newShipment.containersCount ? parseInt(newShipment.containersCount) : undefined,
      valueUsd: newShipment.valueUsd ? parseFloat(newShipment.valueUsd) : undefined,
      arrivalDate: newShipment.arrivalDate || undefined,
      estimatedArrivalDate: newShipment.estimatedArrivalDate || undefined,
      destinationPort: newShipment.destinationPort || undefined,
      departurePort: newShipment.departurePort || undefined,
      vesselName: newShipment.vesselName || undefined,
      voyage: newShipment.voyage || undefined,
      productDescription: newShipment.productDescription || undefined,
    });

    if (response.success && response.data) {
      setShipments((prev) => [response.data!, ...prev]);
      setSelectedShipment(response.data);
      setShowCreateModal(false);
      resetNewShipment();
      setMessage({ type: 'success', text: 'Shipment created successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to create shipment' });
    }
    setCreateSubmitting(false);
  };

  const resetNewShipment = () => {
    setNewShipment({
      bolNumber: '',
      masterBolNumber: '',
      supplierId: '',
      carrierId: '',
      containersCount: '',
      valueUsd: '',
      arrivalDate: '',
      estimatedArrivalDate: '',
      destinationPort: '',
      departurePort: '',
      vesselName: '',
      voyage: '',
      productDescription: '',
    });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShipment || !editShipment.bolNumber.trim()) return;

    setEditSubmitting(true);
    const response = await updateShipment(selectedShipment.id, {
      bolNumber: editShipment.bolNumber.trim(),
      masterBolNumber: editShipment.masterBolNumber || null,
      supplierId: editShipment.supplierId || null,
      carrierId: editShipment.carrierId || null,
      containersCount: editShipment.containersCount ? parseInt(editShipment.containersCount) : null,
      valueUsd: editShipment.valueUsd ? parseFloat(editShipment.valueUsd) : null,
      arrivalDate: editShipment.arrivalDate || null,
      estimatedArrivalDate: editShipment.estimatedArrivalDate || null,
      destinationPort: editShipment.destinationPort || null,
      departurePort: editShipment.departurePort || null,
      vesselName: editShipment.vesselName || null,
      voyage: editShipment.voyage || null,
      productDescription: editShipment.productDescription || null,
    });

    if (response.success && response.data) {
      setShipments((prev) =>
        prev.map((s) => (s.id === selectedShipment.id ? response.data! : s))
      );
      setSelectedShipment(response.data);
      setShowEditModal(false);
      setMessage({ type: 'success', text: 'Shipment updated successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to update shipment' });
    }
    setEditSubmitting(false);
  };

  const handleDelete = async () => {
    if (!selectedShipment) return;

    setDeleteSubmitting(true);
    const response = await deleteShipment(selectedShipment.id);

    if (response.success) {
      setShipments((prev) => prev.filter((s) => s.id !== selectedShipment.id));
      setSelectedShipment(null);
      setShowDeleteConfirm(false);
      setMessage({ type: 'success', text: 'Shipment deleted successfully' });
    } else {
      setMessage({ type: 'error', text: response.error?.message || 'Failed to delete shipment' });
    }
    setDeleteSubmitting(false);
  };

  const openEditModal = () => {
    if (!selectedShipment) return;
    setEditShipment({
      bolNumber: selectedShipment.bolNumber,
      masterBolNumber: selectedShipment.masterBolNumber || '',
      supplierId: selectedShipment.supplierId || '',
      carrierId: selectedShipment.carrierId || '',
      containersCount: selectedShipment.containersCount?.toString() || '',
      valueUsd: selectedShipment.valueUsd?.toString() || '',
      arrivalDate: selectedShipment.arrivalDate?.split('T')[0] || '',
      estimatedArrivalDate: selectedShipment.estimatedArrivalDate?.split('T')[0] || '',
      destinationPort: selectedShipment.destinationPort || '',
      departurePort: selectedShipment.departurePort || '',
      vesselName: selectedShipment.vesselName || '',
      voyage: selectedShipment.voyage || '',
      productDescription: selectedShipment.productDescription || '',
    });
    setShowEditModal(true);
  };

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-gray-500">Please select an organization to view shipments</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoadingOrNoOrg) {
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
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Shipments</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Manage shipments for {currentOrganization.name}
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <svg className="size-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Shipment
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
        {/* Shipment List */}
        <div className="space-y-4">
          <div>
            <Input
              placeholder="Search BOL, ports, vessel..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {filteredShipments.length} Shipment{filteredShipments.length !== 1 ? 's' : ''}
          </h3>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filteredShipments.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-gray-500">No shipments found</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Add your first shipment
                  </Button>
                </CardContent>
              </Card>
            ) : (
              filteredShipments.map((shipment) => (
                <button
                  key={shipment.id}
                  onClick={() => setSelectedShipment(shipment)}
                  className={`w-full text-left p-4 rounded-lg border transition-colors ${
                    selectedShipment?.id === shipment.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="size-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shrink-0">
                      <svg className="size-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium font-mono text-sm truncate">{shipment.bolNumber}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {shipment.supplier?.name || 'No supplier'} &rarr; {shipment.destinationPort || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {shipment.arrivalDate ? formatDate(shipment.arrivalDate) : 'No arrival date'}
                      </p>
                    </div>
                    {shipment.containersCount && (
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                        {shipment.containersCount} cont.
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Shipment Details */}
        <div className="lg:col-span-2 space-y-6">
          {selectedShipment ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-3">
                      <div className="size-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
                        <svg className="size-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                        </svg>
                      </div>
                      <span className="font-mono">{selectedShipment.bolNumber}</span>
                    </CardTitle>
                    <CardDescription className="mt-2">
                      {selectedShipment.masterBolNumber && (
                        <span>Master BOL: <span className="font-mono">{selectedShipment.masterBolNumber}</span></span>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={openEditModal}>Edit</Button>
                    <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>Delete</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <Label className="text-gray-500">Supplier</Label>
                      <p className="font-medium">{selectedShipment.supplier?.name || '-'}</p>
                      {selectedShipment.supplier?.country && (
                        <p className="text-xs text-gray-500">{selectedShipment.supplier.country}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-gray-500">Carrier</Label>
                      <p className="font-medium">{selectedShipment.carrier?.name || '-'}</p>
                      {selectedShipment.carrier?.scacCode && (
                        <p className="text-xs text-gray-500 font-mono">{selectedShipment.carrier.scacCode}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-gray-500">Value</Label>
                      <p className="font-medium">{formatCurrency(selectedShipment.valueUsd)}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Containers</Label>
                      <p className="font-medium">{selectedShipment.containersCount || '-'}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">TEU</Label>
                      <p className="font-medium">{selectedShipment.teu || '-'}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Weight</Label>
                      <p className="font-medium">{selectedShipment.weight ? `${selectedShipment.weight.toLocaleString()} kg` : '-'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Route Information */}
              <Card>
                <CardHeader>
                  <CardTitle>Route Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <Label className="text-blue-600 dark:text-blue-400">Departure</Label>
                      <p className="font-medium text-lg">{selectedShipment.departurePort || '-'}</p>
                      {selectedShipment.departurePortCode && (
                        <p className="text-sm text-gray-500 font-mono">{selectedShipment.departurePortCode}</p>
                      )}
                    </div>
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <Label className="text-green-600 dark:text-green-400">Destination</Label>
                      <p className="font-medium text-lg">{selectedShipment.destinationPort || '-'}</p>
                      {selectedShipment.destinationPortCode && (
                        <p className="text-sm text-gray-500 font-mono">{selectedShipment.destinationPortCode}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-gray-500">Vessel</Label>
                      <p className="font-medium">{selectedShipment.vesselName || '-'}</p>
                      {selectedShipment.vesselCode && (
                        <p className="text-xs text-gray-500 font-mono">{selectedShipment.vesselCode}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-gray-500">Voyage</Label>
                      <p className="font-medium">{selectedShipment.voyage || '-'}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Arrival Date</Label>
                      <p className="font-medium">{formatDate(selectedShipment.arrivalDate)}</p>
                    </div>
                    <div>
                      <Label className="text-gray-500">Est. Arrival</Label>
                      <p className="font-medium">{formatDate(selectedShipment.estimatedArrivalDate)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Product & Containers */}
              <Card>
                <CardHeader>
                  <CardTitle>Cargo Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {selectedShipment.productDescription && (
                      <div>
                        <Label className="text-gray-500">Product Description</Label>
                        <p className="font-medium">{selectedShipment.productDescription}</p>
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label className="text-gray-500">Quantity</Label>
                        <p className="font-medium">
                          {selectedShipment.quantity ? `${selectedShipment.quantity.toLocaleString()} ${selectedShipment.quantityUnit || ''}` : '-'}
                        </p>
                      </div>
                    </div>
                    {selectedShipment.hsCodes && selectedShipment.hsCodes.length > 0 && (
                      <div>
                        <Label className="text-gray-500">HS Codes</Label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {selectedShipment.hsCodes.map((code, idx) => (
                            <span key={code} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                              {code}
                              {selectedShipment.hsCodeDescriptions?.[idx] && (
                                <span className="text-gray-500 ml-1 font-sans">- {selectedShipment.hsCodeDescriptions[idx]}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedShipment.containerIds && selectedShipment.containerIds.length > 0 && (
                      <div>
                        <Label className="text-gray-500">Container IDs</Label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {selectedShipment.containerIds.map((id) => (
                            <span key={id} className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-sm font-mono">
                              {id}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
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
                <p className="mt-4 text-gray-500">Select a shipment to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Add Shipment</CardTitle>
              <CardDescription>Add a new shipment to {currentOrganization.name}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="createBol">BOL Number *</Label>
                    <Input
                      id="createBol"
                      value={newShipment.bolNumber}
                      onChange={(e) => setNewShipment({ ...newShipment, bolNumber: e.target.value })}
                      placeholder="MEDUN1234567"
                      className="font-mono"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createMasterBol">Master BOL</Label>
                    <Input
                      id="createMasterBol"
                      value={newShipment.masterBolNumber}
                      onChange={(e) => setNewShipment({ ...newShipment, masterBolNumber: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="createSupplier">Supplier</Label>
                    <select
                      id="createSupplier"
                      value={newShipment.supplierId}
                      onChange={(e) => setNewShipment({ ...newShipment, supplierId: e.target.value })}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      <option value="">Select supplier...</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createCarrier">Carrier</Label>
                    <select
                      id="createCarrier"
                      value={newShipment.carrierId}
                      onChange={(e) => setNewShipment({ ...newShipment, carrierId: e.target.value })}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      <option value="">Select carrier...</option>
                      {carriers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.scacCode})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="createDeparture">Departure Port</Label>
                    <Input
                      id="createDeparture"
                      value={newShipment.departurePort}
                      onChange={(e) => setNewShipment({ ...newShipment, departurePort: e.target.value })}
                      placeholder="Shanghai"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createDestination">Destination Port</Label>
                    <Input
                      id="createDestination"
                      value={newShipment.destinationPort}
                      onChange={(e) => setNewShipment({ ...newShipment, destinationPort: e.target.value })}
                      placeholder="Los Angeles"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="createVessel">Vessel Name</Label>
                    <Input
                      id="createVessel"
                      value={newShipment.vesselName}
                      onChange={(e) => setNewShipment({ ...newShipment, vesselName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createVoyage">Voyage</Label>
                    <Input
                      id="createVoyage"
                      value={newShipment.voyage}
                      onChange={(e) => setNewShipment({ ...newShipment, voyage: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="createContainers">Containers</Label>
                    <Input
                      id="createContainers"
                      type="number"
                      value={newShipment.containersCount}
                      onChange={(e) => setNewShipment({ ...newShipment, containersCount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createValue">Value (USD)</Label>
                    <Input
                      id="createValue"
                      type="number"
                      step="0.01"
                      value={newShipment.valueUsd}
                      onChange={(e) => setNewShipment({ ...newShipment, valueUsd: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createArrival">Arrival Date</Label>
                    <Input
                      id="createArrival"
                      type="date"
                      value={newShipment.arrivalDate}
                      onChange={(e) => setNewShipment({ ...newShipment, arrivalDate: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="createDescription">Product Description</Label>
                  <Input
                    id="createDescription"
                    value={newShipment.productDescription}
                    onChange={(e) => setNewShipment({ ...newShipment, productDescription: e.target.value })}
                    placeholder="Describe the cargo..."
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => { setShowCreateModal(false); resetNewShipment(); }}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSubmitting}>
                    {createSubmitting ? 'Creating...' : 'Create Shipment'}
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
          <Card className="w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Edit Shipment</CardTitle>
              <CardDescription>Update shipment information</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEdit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editBol">BOL Number *</Label>
                    <Input
                      id="editBol"
                      value={editShipment.bolNumber}
                      onChange={(e) => setEditShipment({ ...editShipment, bolNumber: e.target.value })}
                      className="font-mono"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editMasterBol">Master BOL</Label>
                    <Input
                      id="editMasterBol"
                      value={editShipment.masterBolNumber}
                      onChange={(e) => setEditShipment({ ...editShipment, masterBolNumber: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editSupplier">Supplier</Label>
                    <select
                      id="editSupplier"
                      value={editShipment.supplierId}
                      onChange={(e) => setEditShipment({ ...editShipment, supplierId: e.target.value })}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      <option value="">Select supplier...</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editCarrier">Carrier</Label>
                    <select
                      id="editCarrier"
                      value={editShipment.carrierId}
                      onChange={(e) => setEditShipment({ ...editShipment, carrierId: e.target.value })}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      <option value="">Select carrier...</option>
                      {carriers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.scacCode})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editDeparture">Departure Port</Label>
                    <Input
                      id="editDeparture"
                      value={editShipment.departurePort}
                      onChange={(e) => setEditShipment({ ...editShipment, departurePort: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editDestination">Destination Port</Label>
                    <Input
                      id="editDestination"
                      value={editShipment.destinationPort}
                      onChange={(e) => setEditShipment({ ...editShipment, destinationPort: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editVessel">Vessel Name</Label>
                    <Input
                      id="editVessel"
                      value={editShipment.vesselName}
                      onChange={(e) => setEditShipment({ ...editShipment, vesselName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editVoyage">Voyage</Label>
                    <Input
                      id="editVoyage"
                      value={editShipment.voyage}
                      onChange={(e) => setEditShipment({ ...editShipment, voyage: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="editContainers">Containers</Label>
                    <Input
                      id="editContainers"
                      type="number"
                      value={editShipment.containersCount}
                      onChange={(e) => setEditShipment({ ...editShipment, containersCount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editValue">Value (USD)</Label>
                    <Input
                      id="editValue"
                      type="number"
                      step="0.01"
                      value={editShipment.valueUsd}
                      onChange={(e) => setEditShipment({ ...editShipment, valueUsd: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editArrival">Arrival Date</Label>
                    <Input
                      id="editArrival"
                      type="date"
                      value={editShipment.arrivalDate}
                      onChange={(e) => setEditShipment({ ...editShipment, arrivalDate: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editDescription">Product Description</Label>
                  <Input
                    id="editDescription"
                    value={editShipment.productDescription}
                    onChange={(e) => setEditShipment({ ...editShipment, productDescription: e.target.value })}
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
              <CardTitle className="text-red-600">Delete Shipment</CardTitle>
              <CardDescription>
                This action cannot be undone. This will permanently delete shipment {selectedShipment?.bolNumber}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleteSubmitting}>
                  {deleteSubmitting ? 'Deleting...' : 'Delete Shipment'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
