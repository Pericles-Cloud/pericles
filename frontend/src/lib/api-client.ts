const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4111';

// Session expiration callback - set by AuthProvider
let onSessionExpired: (() => void) | null = null;

/**
 * Set the callback to be called when the session expires.
 * This should be called by the AuthProvider on mount.
 */
export function setSessionExpiredCallback(callback: () => void): void {
  onSessionExpired = callback;
}

/**
 * Clear the session expiration callback.
 */
export function clearSessionExpiredCallback(): void {
  onSessionExpired = null;
}

/**
 * Handle session expiration - clears all cached data and redirects to login.
 */
function handleSessionExpired(): void {
  // Clear all tokens
  clearTokens();

  // Clear any other cached data
  if (typeof window !== 'undefined') {
    // Clear sessionStorage
    sessionStorage.clear();

    // Clear any app-specific localStorage items (keep non-auth items if needed)
    const keysToRemove = ['accessToken', 'refreshToken', 'user', 'organizations', 'currentOrganization'];
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }

  // Notify the auth provider
  if (onSessionExpired) {
    onSessionExpired();
  } else if (typeof window !== 'undefined') {
    // Fallback: redirect directly if no callback is set
    window.location.href = '/login?error=session_expired';
  }
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface RequestOptions {
  method?: string;
  body?: object;
  headers?: Record<string, string>;
  /** Internal: retry attempt counter to prevent infinite refresh loops */
  _retryCount?: number;
}

// Maximum number of retry attempts for token refresh
const MAX_AUTH_RETRIES = 3;
// Request timeout in milliseconds
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Make an API request to the backend.
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers = {}, _retryCount = 0 } = options;

  const accessToken = getAccessToken();

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (accessToken) {
    requestHeaders['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data = await response.json();

    // Handle token expiration with retry limit
    if (response.status === 401) {
      if (data.error?.code === 'INVALID_TOKEN' || data.error?.code === 'TOKEN_EXPIRED') {
        // Prevent infinite refresh loop
        if (_retryCount >= MAX_AUTH_RETRIES) {
          handleSessionExpired();
          return {
            success: false,
            error: {
              code: 'SESSION_EXPIRED',
              message: 'Your session has expired. Please log in again.',
            },
          };
        }

        const refreshed = await refreshAccessToken();
        if (refreshed) {
          // Retry the request with new token (increment retry counter)
          return apiRequest<T>(endpoint, { ...options, _retryCount: _retryCount + 1 });
        } else {
          // Refresh failed - session expired
          handleSessionExpired();
          return {
            success: false,
            error: {
              code: 'SESSION_EXPIRED',
              message: 'Your session has expired. Please log in again.',
            },
          };
        }
      } else if (data.error?.code === 'UNAUTHORIZED') {
        // Not authenticated at all
        handleSessionExpired();
        return {
          success: false,
          error: {
            code: 'SESSION_EXPIRED',
            message: 'Your session has expired. Please log in again.',
          },
        };
      }
    }

    return data;
  } catch (error) {
    // Handle timeout errors specifically
    if (error instanceof Error && error.name === 'TimeoutError') {
      console.error('API request timed out:', endpoint);
      return {
        success: false,
        error: {
          code: 'TIMEOUT_ERROR',
          message: 'Request timed out. Please try again.',
        },
      };
    }
    console.error('API request error:', error);
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Unable to connect to the server',
      },
    };
  }
}

/**
 * Get the stored access token.
 */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

/**
 * Get the stored refresh token.
 */
export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('refreshToken');
}

/**
 * Store tokens in localStorage.
 */
export function storeTokens(accessToken: string, refreshToken?: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('accessToken', accessToken);
  if (refreshToken) {
    localStorage.setItem('refreshToken', refreshToken);
  }
}

/**
 * Clear stored tokens.
 */
export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

/**
 * Attempt to refresh the access token.
 */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data = await response.json();

    if (data.success && data.data) {
      storeTokens(data.data.accessToken, data.data.refreshToken);
      return true;
    }
  } catch (error) {
    console.error('Token refresh error:', error);
  }

  // Refresh failed - clear tokens
  clearTokens();
  return false;
}

// Auth API functions
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
}

export interface AuthResponse {
  user: User;
  organization: Organization | null;
  accessToken: string;
  refreshToken?: string;
}

export interface CurrentUserResponse {
  user: User & { emailVerified: boolean };
  organizations: Organization[];
}

/**
 * Register a new user.
 */
export async function register(
  email: string,
  password: string,
  name?: string
): Promise<ApiResponse<AuthResponse>> {
  return apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: { email, password, name },
  });
}

/**
 * Login with email and password.
 */
export async function login(
  email: string,
  password: string
): Promise<ApiResponse<AuthResponse>> {
  return apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

/**
 * Logout and invalidate tokens.
 */
export async function logout(): Promise<ApiResponse<{ message: string }>> {
  const result = await apiRequest<{ message: string }>('/api/auth/logout', {
    method: 'POST',
  });
  clearTokens();
  return result;
}

/**
 * Get current user info.
 */
export async function getCurrentUser(): Promise<ApiResponse<CurrentUserResponse>> {
  return apiRequest<CurrentUserResponse>('/api/auth/me');
}

/**
 * Get Google OAuth URL.
 */
export function getGoogleAuthUrl(redirect?: string): string {
  const params = redirect ? `?redirect=${encodeURIComponent(redirect)}` : '';
  return `${API_URL}/api/auth/google${params}`;
}

/**
 * Update user profile.
 */
export async function updateProfile(data: {
  name?: string;
  avatarUrl?: string;
}): Promise<ApiResponse<User>> {
  return apiRequest<User>('/api/auth/profile', {
    method: 'PATCH',
    body: data,
  });
}

/**
 * Update user password.
 */
export async function updatePassword(data: {
  currentPassword: string;
  newPassword: string;
}): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>('/api/auth/password', {
    method: 'POST',
    body: data,
  });
}

/**
 * Delete user account.
 */
export async function deleteAccount(): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>('/api/auth/account', {
    method: 'DELETE',
  });
}

// Organization API functions

export interface OrganizationDetails extends Organization {
  emailDomains: string[];
  isRoot: boolean;
  parentOrganizationId: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  phoneNumber: string | null;
  website: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

export interface OrganizationMember {
  id: string;
  userId: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  joinedAt: string;
}

export interface OrganizationInvite {
  id: string;
  email: string;
  role: 'ADMIN' | 'MEMBER' | 'GUEST';
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

/**
 * Get all organizations for the current user.
 */
export async function getOrganizations(): Promise<ApiResponse<OrganizationDetails[]>> {
  return apiRequest<OrganizationDetails[]>('/api/organizations');
}

/**
 * Get a single organization by ID.
 */
export async function getOrganization(id: string): Promise<ApiResponse<OrganizationDetails>> {
  return apiRequest<OrganizationDetails>(`/api/organizations/${id}`);
}

export interface CreateOrganizationData {
  name: string;
  emailDomains?: string[];
  parentOrganizationId?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  phoneNumber?: string;
  website?: string;
}

export interface UpdateOrganizationData {
  name?: string;
  emailDomains?: string[];
  parentOrganizationId?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  phoneNumber?: string | null;
  website?: string | null;
}

/**
 * Create a new organization.
 */
export async function createOrganization(
  data: CreateOrganizationData
): Promise<ApiResponse<OrganizationDetails>> {
  return apiRequest<OrganizationDetails>('/api/organizations', {
    method: 'POST',
    body: data,
  });
}

/**
 * Update an organization.
 */
export async function updateOrganization(
  id: string,
  data: UpdateOrganizationData
): Promise<ApiResponse<OrganizationDetails>> {
  return apiRequest<OrganizationDetails>(`/api/organizations/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

/**
 * Delete an organization.
 */
export async function deleteOrganization(id: string): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/api/organizations/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Get members of an organization.
 */
export async function getOrganizationMembers(
  orgId: string
): Promise<ApiResponse<OrganizationMember[]>> {
  return apiRequest<OrganizationMember[]>(`/api/organizations/${orgId}/members`);
}

/**
 * Update a member's role.
 */
export async function updateMemberRole(
  orgId: string,
  memberId: string,
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST'
): Promise<ApiResponse<OrganizationMember>> {
  return apiRequest<OrganizationMember>(`/api/organizations/${orgId}/members/${memberId}`, {
    method: 'PATCH',
    body: { role },
  });
}

/**
 * Remove a member from an organization.
 */
export async function removeMember(
  orgId: string,
  memberId: string
): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/api/organizations/${orgId}/members/${memberId}`, {
    method: 'DELETE',
  });
}

/**
 * Invite a user to an organization.
 */
export async function inviteMember(
  orgId: string,
  data: { email: string; role: 'ADMIN' | 'MEMBER' | 'GUEST' }
): Promise<ApiResponse<OrganizationInvite>> {
  return apiRequest<OrganizationInvite>(`/api/organizations/${orgId}/invites`, {
    method: 'POST',
    body: data,
  });
}

/**
 * Get pending invites for an organization.
 */
export async function getOrganizationInvites(
  orgId: string
): Promise<ApiResponse<OrganizationInvite[]>> {
  return apiRequest<OrganizationInvite[]>(`/api/organizations/${orgId}/invites`);
}

/**
 * Cancel an invite.
 */
export async function cancelInvite(
  orgId: string,
  inviteId: string
): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/api/organizations/${orgId}/invites/${inviteId}`, {
    method: 'DELETE',
  });
}

/**
 * Leave an organization.
 */
export async function leaveOrganization(orgId: string): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/api/organizations/${orgId}/leave`, {
    method: 'POST',
  });
}

// ============================================
// SUPPLIER API
// ============================================

export interface Supplier {
  id: string;
  organizationId: string;
  name: string;
  address: string | null;
  website: string | null;
  contactInfo: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  totalShipments: number;
  destinationPorts: string[] | null;
  departurePorts: string[] | null;
  hsCodes: string[] | null;
  notifyPartyName: string | null;
  notifyPartyAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierData {
  organizationId: string;
  name: string;
  address?: string;
  website?: string;
  contactInfo?: string;
  country?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  notifyPartyName?: string;
  notifyPartyAddress?: string;
}

export interface UpdateSupplierData {
  name?: string;
  address?: string | null;
  website?: string | null;
  contactInfo?: string | null;
  country?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notifyPartyName?: string | null;
  notifyPartyAddress?: string | null;
}

/**
 * Get all suppliers for the user's organizations.
 */
export async function getSuppliers(
  options?: { organizationId?: string; includeSubsidiaries?: boolean },
): Promise<ApiResponse<Supplier[]>> {
  const params = new URLSearchParams();
  if (options?.organizationId) params.set('organizationId', options.organizationId);
  if (options?.includeSubsidiaries) params.set('includeSubsidiaries', 'true');
  const qs = params.toString();
  return apiRequest<Supplier[]>(`/api/suppliers${qs ? `?${qs}` : ''}`);
}

/**
 * Get a single supplier by ID.
 */
export async function getSupplier(id: string): Promise<ApiResponse<Supplier>> {
  return apiRequest<Supplier>(`/api/suppliers/${id}`);
}

/**
 * Create a new supplier.
 */
export async function createSupplier(data: CreateSupplierData): Promise<ApiResponse<Supplier>> {
  return apiRequest<Supplier>('/api/suppliers', {
    method: 'POST',
    body: data,
  });
}

/**
 * Update a supplier.
 */
export async function updateSupplier(id: string, data: UpdateSupplierData): Promise<ApiResponse<Supplier>> {
  return apiRequest<Supplier>(`/api/suppliers/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

/**
 * Delete a supplier.
 */
export async function deleteSupplier(id: string): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/api/suppliers/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// CARRIER API
// ============================================

export interface Carrier {
  id: string;
  scacCode: string;
  name: string;
  totalShipments: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCarrierData {
  scacCode: string;
  name: string;
}

export interface UpdateCarrierData {
  scacCode?: string;
  name?: string;
}

/**
 * Get all carriers.
 */
export async function getCarriers(): Promise<ApiResponse<Carrier[]>> {
  return apiRequest<Carrier[]>('/api/carriers');
}

/**
 * Get a single carrier by ID.
 */
export async function getCarrier(id: string): Promise<ApiResponse<Carrier>> {
  return apiRequest<Carrier>(`/api/carriers/${id}`);
}

/**
 * Create a new carrier.
 */
export async function createCarrier(data: CreateCarrierData): Promise<ApiResponse<Carrier>> {
  return apiRequest<Carrier>('/api/carriers', {
    method: 'POST',
    body: data,
  });
}

/**
 * Update a carrier.
 */
export async function updateCarrier(id: string, data: UpdateCarrierData): Promise<ApiResponse<Carrier>> {
  return apiRequest<Carrier>(`/api/carriers/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

/**
 * Delete a carrier.
 */
export async function deleteCarrier(id: string): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/api/carriers/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// SHIPMENT API
// ============================================

export interface ShipmentSupplier {
  id: string;
  name: string;
  country: string | null;
  address?: string | null;
}

export interface ShipmentCarrier {
  id: string;
  name: string;
  scacCode: string;
}

export interface Shipment {
  id: string;
  organizationId: string;
  supplierId: string | null;
  carrierId: string | null;
  supplier: ShipmentSupplier | null;
  carrier: ShipmentCarrier | null;
  bolNumber: string;
  masterBolNumber: string | null;
  containersCount: number | null;
  shippingRoute: string | null;
  valueUsd: number | null;
  arrivalDate: string | null;
  estimatedArrivalDate: string | null;
  destinationPort: string | null;
  destinationPortCode: string | null;
  departurePort: string | null;
  departurePortCode: string | null;
  lastVisitForeignPort: string | null;
  vesselName: string | null;
  vesselCode: string | null;
  voyage: string | null;
  containerIds: string[] | null;
  containerSizes: string[] | null;
  containerTypes: string[] | null;
  hsCodes: string[] | null;
  hsCodeDescriptions: string[] | null;
  productDescription: string | null;
  productDescriptionRaw?: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  teu: number | null;
  weight: number | null;
  marksNumbers: string | null;
  marksNumbersRaw?: string | null;
  notifyPartyName: string | null;
  notifyPartyAddress: string | null;
  notifyPartyCountryCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateShipmentData {
  organizationId: string;
  bolNumber: string;
  masterBolNumber?: string;
  supplierId?: string;
  carrierId?: string;
  containersCount?: number;
  shippingRoute?: string;
  valueUsd?: number;
  arrivalDate?: string;
  estimatedArrivalDate?: string;
  destinationPort?: string;
  destinationPortCode?: string;
  departurePort?: string;
  departurePortCode?: string;
  vesselName?: string;
  vesselCode?: string;
  voyage?: string;
  containerIds?: string[];
  containerSizes?: string[];
  containerTypes?: string[];
  hsCodes?: string[];
  hsCodeDescriptions?: string[];
  productDescription?: string;
  quantity?: number;
  quantityUnit?: string;
  teu?: number;
  weight?: number;
  notifyPartyName?: string;
  notifyPartyAddress?: string;
  notifyPartyCountryCode?: string;
}

export interface UpdateShipmentData {
  bolNumber?: string;
  masterBolNumber?: string | null;
  supplierId?: string | null;
  carrierId?: string | null;
  containersCount?: number | null;
  shippingRoute?: string | null;
  valueUsd?: number | null;
  arrivalDate?: string | null;
  estimatedArrivalDate?: string | null;
  destinationPort?: string | null;
  destinationPortCode?: string | null;
  departurePort?: string | null;
  departurePortCode?: string | null;
  vesselName?: string | null;
  vesselCode?: string | null;
  voyage?: string | null;
  containerIds?: string[] | null;
  containerSizes?: string[] | null;
  containerTypes?: string[] | null;
  hsCodes?: string[] | null;
  hsCodeDescriptions?: string[] | null;
  productDescription?: string | null;
  quantity?: number | null;
  quantityUnit?: string | null;
  teu?: number | null;
  weight?: number | null;
  notifyPartyName?: string | null;
  notifyPartyAddress?: string | null;
  notifyPartyCountryCode?: string | null;
}

/**
 * Get all shipments for an organization.
 */
export async function getShipments(
  organizationId: string,
  options?: { includeSubsidiaries?: boolean },
): Promise<ApiResponse<Shipment[]>> {
  const params = new URLSearchParams({ organizationId });
  if (options?.includeSubsidiaries) params.set('includeSubsidiaries', 'true');
  return apiRequest<Shipment[]>(`/api/shipments?${params.toString()}`);
}

/**
 * A live shipment position from the tracking feed (mock today; Terminal49 +
 * AISstream when TRACKING_MODE=live). Feed-agnostic — the shape is identical
 * for mock and real data. See backend/src/integrations/tracking.
 */
export interface ShipmentPosition {
  shipmentId: string;
  position: { lat: number; lng: number };
  bearing: number;
  status: 'departing' | 'in_transit' | 'arriving' | 'arrived';
  percent: number;
  covered_km: number;
  remaining_km: number;
  eta: string;
  vesselName: string | null;
  polyline: Array<{ lat: number; lng: number }>;
  source: 'mock' | 'live';
  /** Owning subsidiary (set on a rollup) — Atlas colors/legends vessels by this. */
  organizationId?: string;
  organizationName?: string;
}

/**
 * Get current vessel positions for an organization's shipments. Polled by Atlas
 * to animate moving dots along their sea-routes.
 */
export async function getShipmentPositions(
  organizationId: string,
  includeSubsidiaries = false,
): Promise<ApiResponse<ShipmentPosition[]>> {
  const sub = includeSubsidiaries ? '&includeSubsidiaries=true' : '';
  return apiRequest<ShipmentPosition[]>(
    `/api/shipments/positions?organizationId=${encodeURIComponent(organizationId)}${sub}`,
  );
}

/**
 * Get a single shipment by ID.
 */
export async function getShipment(id: string): Promise<ApiResponse<Shipment>> {
  return apiRequest<Shipment>(`/api/shipments/${id}`);
}

/**
 * Create a new shipment.
 */
export async function createShipment(data: CreateShipmentData): Promise<ApiResponse<Shipment>> {
  return apiRequest<Shipment>('/api/shipments', {
    method: 'POST',
    body: data,
  });
}

/**
 * Update a shipment.
 */
export async function updateShipment(id: string, data: UpdateShipmentData): Promise<ApiResponse<Shipment>> {
  return apiRequest<Shipment>(`/api/shipments/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

/**
 * Delete a shipment.
 */
export async function deleteShipment(id: string): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/api/shipments/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// EVENT API
// ============================================

export interface EventIncident {
  id: string;
  incidentNumber: string;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedTo: string | null;
  resolvedAt: string | null;
  responsePlanId: string | null;
}

export interface Event {
  id: string;
  organizationId: string;
  eventHash: string;
  type: string;
  source: string;
  title: string;
  description: string;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  detectedAt: string;
  eventTimestamp: string;
  severity: number;
  confidence: number;
  riskFactors: string[];
  affectedDomains: string[];
  validationStatus: 'pending' | 'validated' | 'rejected' | 'duplicate';
  validatedAt: string | null;
  incident: EventIncident | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventsQueryParams {
  organizationId: string;
  validationStatus?: string;
  type?: string;
  source?: string;
  limit?: number;
  offset?: number;
  /** Roll up events from child organizations, as getSuppliers/getShipments do. */
  includeSubsidiaries?: boolean;
}

/**
 * Get all events for an organization.
 */
export async function getEvents(params: EventsQueryParams): Promise<ApiResponse<{ events: Event[]; total: number }>> {
  const queryParams = new URLSearchParams();
  queryParams.append('organizationId', params.organizationId);
  if (params.validationStatus) queryParams.append('validationStatus', params.validationStatus);
  if (params.type) queryParams.append('type', params.type);
  if (params.source) queryParams.append('source', params.source);
  if (params.limit) queryParams.append('limit', params.limit.toString());
  if (params.offset) queryParams.append('offset', params.offset.toString());
  if (params.includeSubsidiaries) queryParams.append('includeSubsidiaries', 'true');

  return apiRequest<{ events: Event[]; total: number }>(`/api/events?${queryParams.toString()}`);
}

/**
 * Get a single event by ID.
 */
export async function getEvent(id: string): Promise<ApiResponse<Event>> {
  return apiRequest<Event>(`/api/events/${id}`);
}

/**
 * Update event validation status.
 */
export async function updateEventValidation(
  id: string,
  data: { validationStatus: 'pending' | 'validated' | 'rejected' | 'duplicate' }
): Promise<ApiResponse<Event>> {
  return apiRequest<Event>(`/api/events/${id}/validation`, {
    method: 'PATCH',
    body: data,
  });
}

/**
 * Ask a question about a specific event (#23) — the per-event Q&A box under
 * Intelligence's Analysis tab. Answers are scoped to that one event's data.
 */
export async function askEventQuestion(
  id: string,
  question: string
): Promise<ApiResponse<{ answer: string }>> {
  return apiRequest<{ answer: string }>(`/api/events/${id}/ask`, {
    method: 'POST',
    body: { question },
  });
}

// ============================================
// MONITORING AGENT API
// ============================================

export interface MonitoringEnabledSources {
  weather: boolean;
  political: boolean;
  cybersecurity: boolean;
  economic: boolean;
  news: boolean;
  maritime: boolean;
  labor: boolean;
  regulatory: boolean;
  pandemic: boolean;
  geopolitical: boolean;
}

export interface MonitoringConfig {
  organizationId: string;
  pollingIntervalMs: number;
  enabledSources: MonitoringEnabledSources;
  geographicFilter: {
    radiusKm: number;
    strictMode: boolean;
  };
  riskFilter: {
    severityThreshold: number;
    confidenceThreshold: number;
    monitoredRiskTypes: string[];
  };
  deduplication: {
    lookbackWindowHours: number;
    enabled: boolean;
  };
  errorHandling: {
    maxBackoffMs: number;
    maxRetries: number;
    stopOnFatalError: boolean;
  };
  observability: {
    enableMetrics: boolean;
    enableAuditLog: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
}

export interface MonitoringCycleMetrics {
  durationMs: number;
  eventsDetected: number;
  eventsPublished: number;
  duplicatesFiltered: number;
  geographyFiltered: number;
  severityFiltered: number;
  toolsExecuted: number;
  toolsSucceeded: number;
  toolsFailed: number;
  errorCount: number;
}

export interface MonitoringTriggerResponse {
  success: boolean;
  organizationId: string;
  metrics: MonitoringCycleMetrics;
  timestamp: string;
}

export interface MonitoringAuditLog {
  id: string;
  organizationId: string;
  eventType: string;
  status: 'success' | 'partial_success' | 'failure';
  eventsDetected: number;
  eventsFiltered: number;
  eventsPublished: number;
  duplicatesFound: number;
  durationMs: number;
  metadata: {
    toolsExecuted: number;
    toolsSucceeded: number;
    toolsFailed: number;
    errors: Array<{ tool: string; error: string; timestamp: string }>;
  };
  createdAt: string;
}

export interface AgentStatus {
  name: string;
  status: 'active' | 'idle' | 'error' | 'stopped';
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveErrors: number;
  totalCycles: number;
  totalEventsDetected: number;
  totalEventsPublished: number;
  config: Partial<MonitoringConfig>;
}

/**
 * Trigger a single monitoring cycle for an organization.
 */
export async function triggerMonitoringCycle(
  organizationId: string
): Promise<ApiResponse<MonitoringTriggerResponse>> {
  return apiRequest<MonitoringTriggerResponse>('/api/monitoring/trigger', {
    method: 'POST',
    body: { organization_id: organizationId },
  });
}

/**
 * Get monitoring audit logs for an organization.
 */
export async function getMonitoringLogs(
  organizationId: string,
  limit: number = 50
): Promise<ApiResponse<MonitoringAuditLog[]>> {
  return apiRequest<MonitoringAuditLog[]>(
    `/api/monitoring/logs?organizationId=${encodeURIComponent(organizationId)}&limit=${limit}`
  );
}

/**
 * Get monitoring agent status for an organization.
 */
export async function getAgentStatus(
  organizationId: string
): Promise<ApiResponse<AgentStatus>> {
  return apiRequest<AgentStatus>(
    `/api/monitoring/status?organizationId=${encodeURIComponent(organizationId)}`
  );
}

/**
 * Update monitoring configuration for an organization.
 */
export async function updateMonitoringConfig(
  organizationId: string,
  config: Partial<MonitoringConfig>
): Promise<ApiResponse<MonitoringConfig>> {
  return apiRequest<MonitoringConfig>('/api/monitoring/config', {
    method: 'PATCH',
    body: { organizationId, ...config },
  });
}

/**
 * Get monitoring configuration for an organization.
 */
export async function getMonitoringConfig(
  organizationId: string
): Promise<ApiResponse<MonitoringConfig>> {
  return apiRequest<MonitoringConfig>(
    `/api/monitoring/config?organizationId=${encodeURIComponent(organizationId)}`
  );
}

// ============================================
// ORGANIZATION SETTINGS API
// ============================================

export interface OrganizationSettings {
  id: string;
  organizationId: string;
  // Agent Settings
  monitoringAgentEnabled: boolean;
  monitoringPollingIntervalMs: number;
  monitoringEnabledSources: MonitoringEnabledSources;
  // AI Settings
  aiModelProvider: string;
  aiModelName: string;
  aiModelTemperature: number;
  aiMaxTokens: number;
  // Notification Settings
  notificationsEmailEnabled: boolean;
  notificationsEmailRecipients: string[];
  notificationsSeverityThreshold: number;
  notificationsSlackEnabled: boolean;
  notificationsSlackWebhookUrl: string | null;
  notificationsDigestEnabled: boolean;
  notificationsDigestFrequency: string;
  // Integration Status
  integrationSapConfigured: boolean;
  integrationSapLastSync: string | null;
  integrationSapSyncFrequency: string;
  // Data Retention
  retentionEventsDays: number;
  retentionAuditLogsDays: number;
  retentionIncidentsDays: number;
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface UpdateOrganizationSettingsData {
  // Agent Settings
  monitoringAgentEnabled?: boolean;
  monitoringPollingIntervalMs?: number;
  monitoringEnabledSources?: Partial<MonitoringEnabledSources>;
  // AI Settings
  aiModelProvider?: string;
  aiModelName?: string;
  aiModelTemperature?: number;
  aiMaxTokens?: number;
  // Notification Settings
  notificationsEmailEnabled?: boolean;
  notificationsEmailRecipients?: string[];
  notificationsSeverityThreshold?: number;
  notificationsSlackEnabled?: boolean;
  notificationsSlackWebhookUrl?: string | null;
  notificationsDigestEnabled?: boolean;
  notificationsDigestFrequency?: string;
  // Integration Status
  integrationSapConfigured?: boolean;
  integrationSapSyncFrequency?: string;
  // Data Retention
  retentionEventsDays?: number;
  retentionAuditLogsDays?: number;
  retentionIncidentsDays?: number;
}

/**
 * Get organization settings.
 */
export async function getOrganizationSettings(
  orgId: string
): Promise<ApiResponse<OrganizationSettings>> {
  return apiRequest<OrganizationSettings>(`/api/organizations/${orgId}/settings`);
}

/**
 * Update organization settings.
 */
export async function updateOrganizationSettings(
  orgId: string,
  data: UpdateOrganizationSettingsData
): Promise<ApiResponse<OrganizationSettings>> {
  return apiRequest<OrganizationSettings>(`/api/organizations/${orgId}/settings`, {
    method: 'PATCH',
    body: data,
  });
}

/**
 * Test notification settings.
 */
export async function testNotification(
  orgId: string,
  type: 'email' | 'slack'
): Promise<ApiResponse<{ message: string; recipients?: string[] }>> {
  return apiRequest<{ message: string; recipients?: string[] }>(
    `/api/organizations/${orgId}/settings/notifications/test`,
    {
      method: 'POST',
      body: { type },
    }
  );
}

// ============================================
// DATA SOURCE TOOL CONFIGURATION API
// ============================================

export type DataSourceCategory =
  | 'weather'
  | 'political'
  | 'cybersecurity'
  | 'economic'
  | 'news'
  | 'maritime'
  | 'labor'
  | 'regulatory'
  | 'pandemic'
  | 'geopolitical';

export interface ToolConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'select';
  description: string;
  default: string | number | boolean | string[];
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  required?: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  documentationUrl?: string;
  apiKeyEnvVar?: string;
  apiKeyLabel?: string;
  requiresApiKey?: boolean;
  defaultEnabled: boolean;
  defaultTimeoutMs: number;
  defaultSeverityThreshold: number;
  defaultLookbackHours: number;
  configFields: ToolConfigField[];
}

export interface DataSourceDefinition {
  id: DataSourceCategory;
  name: string;
  description: string;
  icon: string;
  tools: ToolDefinition[];
}

export interface ToolConfig {
  id: string | null;
  organizationId: string;
  dataSource: string;
  toolId: string;
  toolName: string;
  enabled: boolean;
  apiTimeoutMs: number;
  severityThreshold: number;
  lookbackHours: number;
  config: Record<string, unknown>;
  apiKeyConfigured: boolean;
  apiKeyEnvVar: string | null;
  description: string | null;
  documentationUrl: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  totalEventsFetched: number;
  createdAt: string | null;
  updatedAt: string | null;
  isDefault?: boolean;
  toolDefinition?: ToolDefinition;
}

export interface UpdateToolConfigData {
  enabled?: boolean;
  apiTimeoutMs?: number;
  severityThreshold?: number;
  lookbackHours?: number;
  config?: Record<string, unknown>;
  apiKeyEnvVar?: string;
  description?: string;
}

/**
 * Get available data source definitions.
 */
export async function getDataSourceDefinitions(): Promise<ApiResponse<DataSourceDefinition[]>> {
  return apiRequest<DataSourceDefinition[]>('/api/data-sources');
}

/**
 * Get all tool configs for an organization.
 */
export async function getToolConfigs(orgId: string): Promise<ApiResponse<ToolConfig[]>> {
  return apiRequest<ToolConfig[]>(`/api/organizations/${orgId}/tool-configs`);
}

/**
 * Get tool configs for a specific data source.
 */
export async function getDataSourceToolConfigs(
  orgId: string,
  dataSource: DataSourceCategory
): Promise<ApiResponse<{ dataSource: DataSourceDefinition; configs: ToolConfig[] }>> {
  return apiRequest<{ dataSource: DataSourceDefinition; configs: ToolConfig[] }>(
    `/api/organizations/${orgId}/tool-configs/${dataSource}`
  );
}

/**
 * Get a specific tool config.
 */
export async function getToolConfig(
  orgId: string,
  dataSource: DataSourceCategory,
  toolId: string
): Promise<ApiResponse<ToolConfig>> {
  return apiRequest<ToolConfig>(
    `/api/organizations/${orgId}/tool-configs/${dataSource}/${toolId}`
  );
}

/**
 * Update a tool config.
 */
export async function updateToolConfig(
  orgId: string,
  dataSource: DataSourceCategory,
  toolId: string,
  data: UpdateToolConfigData
): Promise<ApiResponse<ToolConfig>> {
  return apiRequest<ToolConfig>(
    `/api/organizations/${orgId}/tool-configs/${dataSource}/${toolId}`,
    {
      method: 'PUT',
      body: data,
    }
  );
}

/**
 * Delete a tool config (reset to defaults).
 */
export async function deleteToolConfig(
  orgId: string,
  dataSource: DataSourceCategory,
  toolId: string
): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(
    `/api/organizations/${orgId}/tool-configs/${dataSource}/${toolId}`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * Seed default tool configs for an organization.
 */
export async function seedToolConfigs(
  orgId: string,
  overwrite: boolean = false
): Promise<ApiResponse<{ message: string; created: number; skipped: number; tools: { created: string[]; skipped: string[] } }>> {
  return apiRequest<{ message: string; created: number; skipped: number; tools: { created: string[]; skipped: string[] } }>(
    `/api/organizations/${orgId}/tool-configs/seed-defaults`,
    {
      method: 'POST',
      body: { overwrite },
    }
  );
}

// API Key Types
export interface ApiKeyStatus {
  requiresApiKey: boolean;
  apiKeyLabel?: string;
  apiKeyEnvVar?: string;
  status: 'not_required' | 'configured' | 'env_var' | 'not_configured';
  envVarName: string | null;
  envVarConfigured: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

export interface ApiKeyTestResult {
  success: boolean;
  message: string;
  details?: string;
}

export interface SaveApiKeyData {
  apiKey?: string;
  useEnvVar?: boolean;
}

/**
 * Get API key status for a tool.
 */
export async function getApiKeyStatus(
  orgId: string,
  dataSource: DataSourceCategory,
  toolId: string
): Promise<ApiResponse<ApiKeyStatus>> {
  return apiRequest<ApiKeyStatus>(
    `/api/organizations/${orgId}/tool-configs/${dataSource}/${toolId}/api-key-status`
  );
}

/**
 * Save API key for a tool.
 */
export async function saveApiKey(
  orgId: string,
  dataSource: DataSourceCategory,
  toolId: string,
  data: SaveApiKeyData
): Promise<ApiResponse<{ message: string; envVar?: string; isConfigured: boolean }>> {
  return apiRequest<{ message: string; envVar?: string; isConfigured: boolean }>(
    `/api/organizations/${orgId}/tool-configs/${dataSource}/${toolId}/api-key`,
    {
      method: 'PUT',
      body: data,
    }
  );
}

/**
 * Test API key for a tool.
 */
export async function testApiKey(
  orgId: string,
  dataSource: DataSourceCategory,
  toolId: string,
  apiKey?: string
): Promise<ApiResponse<ApiKeyTestResult>> {
  return apiRequest<ApiKeyTestResult>(
    `/api/organizations/${orgId}/tool-configs/${dataSource}/${toolId}/test-api-key`,
    {
      method: 'POST',
      body: apiKey ? { apiKey } : {},
    }
  );
}

// ============================================
// WORKFLOW API (Plans Workflow Builder)
// ============================================

export type WorkflowStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ExecutionMode = 'MANUAL' | 'AUTOMATIC' | 'BOTH';
export type NodeType = 'TRIGGER' | 'ACTION' | 'CONDITION' | 'NOTIFICATION' | 'END';
export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface WorkflowNode {
  id: string;
  clientId: string;
  type: NodeType;
  label: string | null;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  clientId: string;
  source: string; // clientId of source node
  target: string; // clientId of target node
  sourceHandle: string | null;
  targetHandle: string | null;
  label: string | null;
  data: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  version: number;
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  executionMode: ExecutionMode;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  counts?: {
    nodes: number;
    edges: number;
    executions: number;
  };
}

export interface CreateWorkflowData {
  name: string;
  description?: string;
  executionMode?: ExecutionMode;
}

export interface UpdateWorkflowData {
  name?: string;
  description?: string | null;
  executionMode?: ExecutionMode;
  isActive?: boolean;
  viewportX?: number;
  viewportY?: number;
  viewportZoom?: number;
}

export interface SaveWorkflowStateData {
  nodes: Array<{
    clientId: string;
    type: NodeType;
    label?: string;
    positionX: number;
    positionY: number;
    data?: Record<string, unknown>;
  }>;
  edges: Array<{
    clientId: string;
    sourceNodeClientId: string;
    targetNodeClientId: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
    data?: Record<string, unknown>;
  }>;
  viewportX?: number;
  viewportY?: number;
  viewportZoom?: number;
}

export type WorkflowRunMode = 'trial' | 'run';

export type NodeExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ExecutionLog {
  nodeId: string;
  nodeClientId: string;
  nodeType: NodeType;
  nodeLabel: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: unknown;
  error?: string;
  skippedReason?: string;
  simulated?: boolean;
}

export interface WorkflowExecution {
  id: string;
  status: ExecutionStatus;
  triggeredBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  executionLog: ExecutionLog[];
  createdAt: string;
  durationMs?: number;
  mode?: WorkflowRunMode;
}

/**
 * List workflows for an organization.
 */
export async function getWorkflows(
  orgId: string,
  status?: WorkflowStatus
): Promise<ApiResponse<Workflow[]>> {
  const params = status ? `?status=${status}` : '';
  return apiRequest<Workflow[]>(`/api/organizations/${orgId}/workflows${params}`);
}

/**
 * Get a single workflow with nodes and edges.
 */
export async function getWorkflow(
  orgId: string,
  workflowId: string
): Promise<ApiResponse<Workflow>> {
  return apiRequest<Workflow>(`/api/organizations/${orgId}/workflows/${workflowId}`);
}

/**
 * Create a new workflow.
 */
export async function createWorkflow(
  orgId: string,
  data: CreateWorkflowData
): Promise<ApiResponse<Workflow>> {
  return apiRequest<Workflow>(`/api/organizations/${orgId}/workflows`, {
    method: 'POST',
    body: data,
  });
}

/**
 * Update workflow metadata.
 */
export async function updateWorkflow(
  orgId: string,
  workflowId: string,
  data: UpdateWorkflowData
): Promise<ApiResponse<Workflow>> {
  return apiRequest<Workflow>(`/api/organizations/${orgId}/workflows/${workflowId}`, {
    method: 'PATCH',
    body: data,
  });
}

/**
 * Save workflow state (nodes and edges).
 */
export async function saveWorkflowState(
  orgId: string,
  workflowId: string,
  data: SaveWorkflowStateData
): Promise<ApiResponse<Workflow>> {
  return apiRequest<Workflow>(`/api/organizations/${orgId}/workflows/${workflowId}/state`, {
    method: 'PUT',
    body: data,
  });
}

/**
 * Delete a workflow.
 */
export async function deleteWorkflow(
  orgId: string,
  workflowId: string
): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/api/organizations/${orgId}/workflows/${workflowId}`, {
    method: 'DELETE',
  });
}

/**
 * Publish a workflow.
 */
export async function publishWorkflow(
  orgId: string,
  workflowId: string
): Promise<ApiResponse<Workflow>> {
  return apiRequest<Workflow>(`/api/organizations/${orgId}/workflows/${workflowId}/publish`, {
    method: 'POST',
  });
}

/**
 * Archive a workflow.
 */
export async function archiveWorkflow(
  orgId: string,
  workflowId: string
): Promise<ApiResponse<Workflow>> {
  return apiRequest<Workflow>(`/api/organizations/${orgId}/workflows/${workflowId}/archive`, {
    method: 'POST',
  });
}

export interface WorkflowExecutionResult {
  id: string;
  status: ExecutionStatus;
  executionLog: ExecutionLog[];
  error?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  mode: WorkflowRunMode;
}

export interface ExecuteWorkflowOptions {
  mode?: WorkflowRunMode;
  initialVariables?: Record<string, unknown>;
}

/**
 * Execute a workflow manually.
 *
 * @param orgId - Organization ID
 * @param workflowId - Workflow ID
 * @param options - Execution options (mode: 'trial' | 'run', initialVariables)
 */
export async function executeWorkflow(
  orgId: string,
  workflowId: string,
  options: ExecuteWorkflowOptions = {}
): Promise<ApiResponse<WorkflowExecutionResult>> {
  const { mode = 'run', initialVariables } = options;
  // `/execute` — the server takes trial vs run from the body, not the path.
  // This used to POST to `/trial`, which only ever existed in the deleted
  // Vercel serverless tree; the Express server has never served that path, so
  // the call 404'd on the deployed backend.
  return apiRequest<WorkflowExecutionResult>(
    `/api/organizations/${orgId}/workflows/${workflowId}/execute`,
    {
      method: 'POST',
      body: { mode, initialVariables },
    }
  );
}

/**
 * Get workflow executions.
 */
export async function getWorkflowExecutions(
  orgId: string,
  workflowId: string,
  limit?: number
): Promise<ApiResponse<WorkflowExecution[]>> {
  const params = limit ? `?limit=${limit}` : '';
  return apiRequest<WorkflowExecution[]>(
    `/api/organizations/${orgId}/workflows/${workflowId}/executions${params}`
  );
}
