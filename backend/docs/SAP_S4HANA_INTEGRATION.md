## SAP S/4HANA Cloud Integration Documentation

This document describes the SAP S/4HANA Cloud integration for Pericles supply chain risk monitoring.

---

## Overview

The SAP S/4HANA integration synchronizes enterprise resource planning (ERP) data from SAP S/4HANA Cloud into Pericles for real-time supply chain risk monitoring. This integration enables the Monitoring Agent to understand organizational supply chain footprint and detect relevant disruption events.

### Key Features

- **Bi-directional Integration**: Reads from SAP OData APIs, writes to Pericles PostgreSQL
- **Mock Mode**: Simulates SAP API responses for development/testing
- **Production Mode**: Connects to real SAP S/4HANA Cloud tenant via OAuth 2.0
- **Automatic Transformation**: Converts SAP data structures to Pericles OrganizationContext format
- **Scheduled Sync**: Runs every 30 minutes (configurable) to keep data fresh
- **Validation**: Ensures data integrity before persisting to database

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SAP S/4HANA Cloud Tenant                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ API_BUSINESS │  │ API_PLANT    │  │ Z_SHIPPING   │          │
│  │ _PARTNER     │  │ _SRV         │  │ _LANES_SRV   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
          │ OAuth 2.0 + OData V2                │
          │                  │                  │
          ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│              SAP Integration Client (client.ts)              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Mock API (mock-api.ts) OR Production API (OData)     │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
          ┌──────────────────────────────┐
          │  Transformer (transformer.ts) │
          │  SAP → OrganizationContext    │
          └──────────────┬────────────────┘
                         │
                         ▼
          ┌──────────────────────────────┐
          │  Sync Service (sync-service.ts)│
          │  - Validation                 │
          │  - Database Operations        │
          └──────────────┬────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│              PostgreSQL (pericles database)                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  OrganizationContext Table                                │  │
│  │  - plants: JSONB                                          │  │
│  │  - warehouses: JSONB                                      │  │
│  │  - suppliers: JSONB                                       │  │
│  │  - shipping_lanes: JSONB                                  │  │
│  │  - risk_preferences: Columns                              │  │
│  │  - last_erp_sync: TIMESTAMP                               │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
          ┌──────────────────────────────┐
          │  Monitoring Agent             │
          │  - erpContextTool reads data  │
          │  - Geographic filtering       │
          │  - Impact assessment          │
          └───────────────────────────────┘
```

---

## SAP S/4HANA APIs Used

### 1. API_BUSINESS_PARTNER (Suppliers/Customers)

**Endpoint**: `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner`

**Purpose**: Retrieve supplier master data with locations

**Key Fields**:
- `BusinessPartner` - Unique supplier ID
- `BusinessPartnerName` - Supplier name
- `to_BusinessPartnerAddress` - Address with geocoding
- `to_Supplier` - Supplier-specific data (tier, risk score, criticality)

**Query Parameters**:
```
$filter=to_Supplier ne null
$expand=to_BusinessPartnerAddress,to_Supplier
```

**Reference**: [API Documentation](https://api.sap.com/api/API_BUSINESS_PARTNER)

---

### 2. API_PLANT_SRV (Plants/Warehouses)

**Endpoint**: `/sap/opu/odata/sap/API_PLANT_SRV/A_Plant` *(or custom Z-API)*

**Purpose**: Retrieve manufacturing plants and warehouse locations

**Key Fields**:
- `Plant` - 4-digit plant code (e.g., "1000")
- `PlantName` - Plant description
- `PlantCategory` - "A" = Manufacturing, "B" = Warehouse
- `Latitude` / `Longitude` - Geocoding
- `PlantCapacity` / `PlantUtilization` - Operational metrics

**Reference**: Custom API or API_GRMASTERDATA_SRV

---

### 3. Z_SHIPPING_LANES_SRV (Shipping Routes)

**Endpoint**: `/sap/opu/odata/sap/Z_SHIPPING_LANES_SRV/ShippingLanes` *(custom)*

**Purpose**: Map shipping routes between plants for logistics risk monitoring

**Key Fields**:
- `ShippingLaneID` - Unique lane identifier
- `OriginPlant` / `DestinationPlant` - Plant IDs
- `ShipmentMode` - "01" = Air, "02" = Ocean, "03" = Truck, "04" = Rail
- `TransitTimeInDays` - Expected transit duration
- `RouteWaypoints` - Intermediate ports/stops (for maritime lanes)

**Note**: This is typically a custom SAP API created for supply chain visibility. If unavailable, shipping lanes can be inferred from historical shipment data.

---

## Authentication: OAuth 2.0 Client Credentials

SAP S/4HANA Cloud uses OAuth 2.0 for API authentication.

### Setup in SAP (Administrator)

1. **Create Communication User**:
   - Go to Fiori app: "Maintain Communication Users"
   - Create user: `PERICLES_API_USER`
   - Assign authorizations: `SAP_CORE_BC_COM`

2. **Create Communication System**:
   - Go to Fiori app: "Communication Systems"
   - Create system: `PERICLES_INTEGRATION`
   - Enable OAuth 2.0 with client credentials grant type
   - Generate Client ID and Client Secret → **Save these securely**

3. **Create Communication Arrangement**:
   - Go to Fiori app: "Communication Arrangements"
   - Create arrangement using scenario: `SAP_COM_0008` (Business Partner API)
   - Assign communication system: `PERICLES_INTEGRATION`
   - Note the **Service URL** from inbound services

4. **Activate Required APIs**:
   - `SAP_COM_0008` - Business Partner (A2X)
   - `SAP_COM_XXXX` - Plant data (if standard API exists)
   - Custom Z-APIs for shipping lanes

### OAuth Token Request

```bash
curl -X POST https://my123456-api.s4hana.ondemand.com/sap/bc/sec/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic <base64(client_id:client_secret)>" \
  -d "grant_type=client_credentials&scope=API_BUSINESS_PARTNER_0001"
```

**Response**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "API_BUSINESS_PARTNER_0001"
}
```

---

## Configuration

### Environment Variables

Add to `backend/.env`:

```bash
# SAP S/4HANA Cloud Configuration
SAP_S4HANA_BASE_URL=https://my123456-api.s4hana.ondemand.com
SAP_S4HANA_CLIENT_ID=your-oauth-client-id
SAP_S4HANA_CLIENT_SECRET=your-oauth-client-secret
SAP_S4HANA_TIMEOUT=30000                # Request timeout (ms)
SAP_S4HANA_USE_MOCK=true                # Use mock API (false for production)
```

### Mock vs. Production Mode

**Mock Mode** (default for development):
- Uses hardcoded Levi Strauss data in `mock-api.ts`
- No SAP connection required
- Instant responses (~200ms simulated delay)
- Set `SAP_S4HANA_USE_MOCK=true`

**Production Mode**:
- Connects to real SAP S/4HANA Cloud tenant
- Requires OAuth credentials and network access
- Subject to SAP API rate limits
- Set `SAP_S4HANA_USE_MOCK=false`

---

## Data Synchronization

### Sync Frequency

- **Default**: Every 30 minutes
- **Configurable**: Set via cron job or Vercel Cron (minimum 1 minute)
- **On-Demand**: Run manually via CLI script

### Sync Process

1. **Fetch from SAP**:
   ```typescript
   const suppliers = await sapClient.getBusinessPartners({
     $expand: 'to_BusinessPartnerAddress,to_Supplier',
     $filter: 'to_Supplier ne null'
   });
   ```

2. **Transform Data**:
   ```typescript
   const contextData = transformSAPDataToOrganizationContext(
     suppliersResponse,
     plantsResponse,
     shippingLanesResponse
   );
   ```

3. **Validate**:
   ```typescript
   const validation = validateOrganizationContext(contextData);
   if (!validation.valid) {
     console.warn('Validation errors:', validation.errors);
   }
   ```

4. **Persist to Database**:
   ```typescript
   await prisma.organizationContext.upsert({
     where: { organization_id: orgId },
     update: { plants: contextData.plants, ... },
     create: { organization_id: orgId, plants: contextData.plants, ... }
   });
   ```

---

## Usage

### CLI Script

#### Sync Single Organization (Levi Strauss)
```bash
cd backend
npx tsx src/scripts/sync-sap-erp.ts \
  --org-id=550e8400-e29b-41d4-a716-446655440000 \
  --verbose
```

#### Sync All Organizations
```bash
npx tsx src/scripts/sync-sap-erp.ts --all --verbose
```

#### Dry Run (Preview Changes)
```bash
npx tsx src/scripts/sync-sap-erp.ts --all --dry-run --verbose
```

#### Test SAP Connection
```bash
npx tsx src/scripts/sync-sap-erp.ts --test
```

**Output**:
```
Testing SAP S/4HANA Cloud connection...

Connection Test Result:
  Status:    ok
  Mode:      mock
  Timestamp: 2025-12-13T21:05:00.000Z

✓ SAP connection successful!
```

### Programmatic Usage

```typescript
import { syncSAPDataForOrganization } from './integrations/sap/sync-service';

const result = await syncSAPDataForOrganization(
  '550e8400-e29b-41d4-a716-446655440000',
  { verbose: true }
);

console.log(`Synced ${result.records_synced.suppliers} suppliers`);
```

---

## Data Transformation

### SAP → Pericles Mapping

#### Supplier Locations

**SAP Structure**:
```json
{
  "BusinessPartner": "0000100001",
  "BusinessPartnerName": "Saitex International",
  "to_BusinessPartnerAddress": [{
    "Country": "VN",
    "CityName": "Ho Chi Minh City",
    "Latitude": "10.8231",
    "Longitude": "106.6297"
  }],
  "to_Supplier": {
    "SupplierTier": 1,
    "IsCriticalSupplier": true,
    "SupplierRiskScore": 0.25
  }
}
```

**Pericles Structure**:
```json
{
  "supplier_id": "0000100001",
  "name": "Saitex International",
  "location": {
    "name": "Ho Chi Minh City",
    "latitude": 10.8231,
    "longitude": 106.6297
  },
  "country": "VN",
  "tier": 1,
  "critical": true,
  "risk_score": 0.25
}
```

#### Plant Locations

**SAP Structure**:
```json
{
  "Plant": "1000",
  "PlantName": "San Francisco DC",
  "PlantCategory": "B",
  "Country": "US",
  "CityName": "San Francisco",
  "Latitude": "37.7749",
  "Longitude": "-122.4194",
  "PlantCapacity": 500000,
  "PlantUtilization": 78
}
```

**Pericles Structure** (Warehouse):
```json
{
  "warehouse_id": "1000",
  "name": "San Francisco DC",
  "location": {
    "name": "San Francisco",
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "country": "US",
  "capacity": 500000,
  "utilization": 78
}
```

#### Shipping Lanes

**SAP Structure**:
```json
{
  "ShippingLaneID": "LANE003",
  "OriginPlant": "5000",
  "DestinationPlant": "1000",
  "ShipmentMode": "02",
  "Carrier": "Maersk Line",
  "TransitTimeInDays": 18,
  "RouteWaypoints": [
    { "latitude": 31.2304, "longitude": 121.4737, "locationName": "Shanghai Port" },
    { "latitude": 37.7749, "longitude": -122.4194, "locationName": "San Francisco" }
  ]
}
```

**Pericles Structure**:
```json
{
  "lane_id": "LANE003",
  "origin": {
    "plant_id": "5000",
    "name": "Shanghai DC",
    "latitude": 31.2304,
    "longitude": 121.4737
  },
  "destination": {
    "plant_id": "1000",
    "name": "San Francisco DC",
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "mode": "ocean",
  "carrier": "Maersk Line",
  "transit_days": 18,
  "active": true
}
```

---

## Monitoring Agent Integration

The Monitoring Agent uses the `erpContextTool` to retrieve synchronized SAP data:

```typescript
// Inside monitoring-agent.ts

// Step 1: Get organization's ERP context
const erpContext = await erpContextTool.execute({
  context: { organization_id: '550e8400-e29b-41d4-a716-446655440000' }
});

// Step 2: Use supplier locations for geographic filtering
const supplierLocations = erpContext.suppliers.map(s => s.location);

// Step 3: Calculate proximity to event
const isRelevant = supplierLocations.some(loc =>
  calculateDistance(eventLat, eventLon, loc.latitude, loc.longitude) <= 100
);

// Step 4: Apply risk preferences
const severityThreshold = erpContext.risk_preferences.severity_threshold;
if (eventSeverity >= severityThreshold && isRelevant) {
  // Publish event
}
```

---

## Error Handling

### Common Issues

**1. OAuth Authentication Failed**
```
Error: OAuth authentication failed: 401 Unauthorized
```
**Solution**: Verify `SAP_S4HANA_CLIENT_ID` and `SAP_S4HANA_CLIENT_SECRET` in `.env`

**2. Invalid Coordinates**
```
Warning: Supplier 0000100005 has invalid coordinates
```
**Solution**: Update SAP Business Partner address with valid geocoding. Use SAP Fiori app "Maintain Business Partner" → Address tab

**3. Missing Navigation Properties**
```
Error: to_Supplier is null for BusinessPartner 0000100010
```
**Solution**: Ensure `$expand=to_Supplier` is included in OData query

**4. Rate Limit Exceeded**
```
Error: SAP API Error: 429 - Too Many Requests
```
**Solution**: Reduce sync concurrency or increase interval between syncs

### Validation Warnings

The transformer validates data before persisting:

```typescript
const validation = validateOrganizationContext(contextData);
// Returns: { valid: boolean, errors: string[] }
```

**Example Warnings**:
- "Supplier 0000100003 has invalid coordinates" → Missing lat/lon
- "Geographic radius must be greater than 0" → Invalid config
- "Severity threshold must be between 0 and 1" → Invalid config

---

## Levi Strauss Mock Data

The mock SAP API includes realistic Levi's supply chain data:

### Suppliers (3 examples)
1. **Saitex International** (Vietnam) - Tier 1, Critical, Risk: 0.25
2. **Nien Hsing Textile** (Taiwan) - Tier 1, Critical, Risk: 0.18
3. **Arvind Limited** (India) - Tier 1, Critical, Risk: 0.42

### Plants/Warehouses (5 locations)
1. **San Francisco DC** (US) - Warehouse, 500k capacity
2. **Memphis DC** (US) - Warehouse, 750k capacity
3. **El Paso Manufacturing** (US) - Plant, 250k capacity
4. **Rotterdam DC** (Netherlands) - Warehouse, 600k capacity
5. **Shanghai DC** (China) - Warehouse, 800k capacity

### Shipping Lanes (4 routes)
1. San Francisco → Memphis (Truck, 4 days)
2. El Paso → San Francisco (Rail, 5 days)
3. Shanghai → San Francisco (Ocean, 18 days)
4. Rotterdam → San Francisco (Ocean, 25 days)

---

## Scheduled Sync (Production)

### Option 1: Cron Job (Linux/Mac)

```bash
# Edit crontab
crontab -e

# Add entry (every 30 minutes)
*/30 * * * * cd /path/to/backend && npx tsx src/scripts/sync-sap-erp.ts --all >> /var/log/sap-sync.log 2>&1
```

### Option 2: PM2 Cron

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'sap-sync',
    script: 'src/scripts/sync-sap-erp.ts',
    interpreter: 'npx',
    interpreterArgs: 'tsx',
    args: '--all',
    cron_restart: '*/30 * * * *',  // Every 30 minutes
    autorestart: false,
    watch: false
  }]
};
```

### Option 3: Vercel Cron (Serverless)

```json
// vercel.json
{
  "crons": [{
    "path": "/api/sap/sync",
    "schedule": "*/30 * * * *"
  }]
}
```

---

## Testing

### Unit Tests

```bash
# Test SAP client
npx tsx src/integrations/sap/__tests__/client.test.ts

# Test transformer
npx tsx src/integrations/sap/__tests__/transformer.test.ts
```

### Integration Test

```bash
# Test full sync flow with mock API
npx tsx src/scripts/sync-sap-erp.ts \
  --org-id=550e8400-e29b-41d4-a716-446655440000 \
  --dry-run \
  --verbose
```

**Expected Output**:
```
[SAP Sync] Starting sync for organization: 550e8400-e29b-41d4-a716-446655440000
[SAP Sync] Found organization: Levi Strauss & Co.
[SAP Sync] Fetching data from SAP S/4HANA Cloud...
[SAP Sync] Fetched 3 suppliers, 5 plants, 4 shipping lanes
[SAP Sync] DRY RUN - Would have synced: { plants: 1, warehouses: 4, suppliers: 3, shipping_lanes: 4 }
[SAP Sync] Completed in 632ms

Sync Result:
  Success:        ✓
  Organization:   550e8400-e29b-41d4-a716-446655440000
  Plants:         1
  Warehouses:     4
  Suppliers:      3
  Shipping Lanes: 4
  Timestamp:      2025-12-13T21:10:00.000Z
```

---

## Performance Considerations

- **Mock API**: ~200ms per request (simulated delay)
- **Production API**: ~500-2000ms per request (network + SAP processing)
- **Sync Duration** (all orgs): ~5-10 seconds (mock), ~30-60 seconds (production)
- **Rate Limits**: SAP Cloud typically allows 100 req/min per client
- **Data Volume**: ~5KB per organization (compressed JSON)

---

## Security Best Practices

1. **Never commit credentials** - Use environment variables only
2. **Rotate OAuth secrets** - Every 90 days minimum
3. **Use read-only SAP user** - Grant minimum required authorizations
4. **Enable audit logging** - Track all API access in SAP
5. **Encrypt at rest** - Database encryption for OrganizationContext
6. **TLS 1.3** - Force HTTPS for SAP API connections
7. **IP whitelisting** - Restrict SAP API access to known IPs

---

## References

- [SAP Business Accelerator Hub](https://api.sap.com/package/SAPS4HANACloud/odata)
- [SAP OData V2 Specification](https://www.odata.org/documentation/odata-version-2-0/)
- [SAP OAuth 2.0 Guide](https://help.sap.com/docs/SAP_S4HANA_CLOUD)
- [Complete Guide to SAP S/4HANA APIs](https://www.apideck.com/blog/guide-to-sap-4-hana-rest-and-soap-api)
- [Business Partner OData API](https://blogs.sap.com/2020/09/11/how-access-business-partner-odata-service-in-sap-s-4hana-cloud/)
- [SAP S/4HANA Cloud Public Edition APIs](https://api.sap.com/products/SAPS4HANACloud/overview)

---

## Support

For issues or questions:
- **SAP API Issues**: SAP Support Portal (S-user required)
- **Pericles Integration**: GitHub Issues
- **OAuth Configuration**: See `backend/docs/ORGANIZATION_CONTEXT.md`
