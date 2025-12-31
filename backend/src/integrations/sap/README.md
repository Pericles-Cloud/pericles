# SAP S/4HANA Cloud Integration

This directory contains the SAP S/4HANA Cloud integration for Pericles supply chain risk monitoring.

## Quick Links

📖 **[SAP Usage Guide](../../../docs/SAP_USAGE_GUIDE.md)** - User-friendly guide for operations teams
🔧 **[SAP Technical Integration Docs](../../../docs/SAP_S4HANA_INTEGRATION.md)** - Complete technical reference
📊 **[Organization Context Guide](../../../docs/ORGANIZATION_CONTEXT.md)** - How ERP data is used

---

## Directory Structure

```
src/integrations/sap/
├── README.md                 # This file
├── types.ts                  # TypeScript types for SAP OData APIs
├── mock-api.ts               # Mock SAP API with Levi Strauss test data
├── client.ts                 # SAP API client (OAuth 2.0 + OData)
├── transformer.ts            # SAP → OrganizationContext transformation
├── sync-service.ts           # Sync service for scheduled ERP updates
└── index.ts                  # Module exports
```

---

## Quick Start

### Test SAP Connection

```bash
cd backend
npx tsx src/scripts/sync-sap-erp.ts --test
```

### Sync Data (Mock Mode)

```bash
npx tsx src/scripts/sync-sap-erp.ts \
  --org-id=550e8400-e29b-41d4-a716-446655440000 \
  --verbose
```

### Verify Sync

```sql
SELECT * FROM "OrganizationContext"
WHERE organization_id = '550e8400-e29b-41d4-a716-446655440000';
```

---

## Architecture

```
SAP S/4HANA Cloud
    │
    │ OAuth 2.0 + OData V2
    ▼
┌─────────────────────────┐
│   SAP Client (client.ts)│
│   • Mock API (dev)      │
│   • Real API (prod)     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Transformer             │
│ (transformer.ts)        │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Sync Service            │
│ (sync-service.ts)       │
└───────────┬─────────────┘
            │
            ▼
    PostgreSQL
    OrganizationContext
```

---

## Files

### `types.ts`

TypeScript interfaces for SAP OData V2 APIs:

- `SAPBusinessPartner` - Suppliers/customers
- `SAPPlant` - Manufacturing plants
- `SAPMaterial` - Products
- `SAPMaterialStock` - Inventory
- `SAPShipment` - Deliveries
- `SAPShippingLane` - Routes

Based on official SAP API schemas from [api.sap.com](https://api.sap.com).

---

### `mock-api.ts`

Mock SAP API for development/testing. Includes realistic Levi Strauss data:

- **3 Suppliers**: Saitex (Vietnam), Nien Hsing (Taiwan), Arvind (India)
- **5 Facilities**: 1 plant + 4 distribution centers
- **4 Shipping Lanes**: Including Shanghai → San Francisco ocean route

**Usage:**
```typescript
import { mockSAPAPI } from './mock-api';

const suppliers = await mockSAPAPI.getBusinessPartners();
// Returns 3 mock suppliers with realistic data
```

---

### `client.ts`

Production SAP API client with OAuth 2.0 authentication.

**Features:**
- Automatic token refresh
- OData query support (`$filter`, `$expand`, `$top`, etc.)
- Configurable timeout and retry logic
- Switches between mock/production based on `SAP_S4HANA_USE_MOCK` env var

**Usage:**
```typescript
import { sapClient } from './client';

const suppliers = await sapClient.getBusinessPartners({
  $expand: 'to_BusinessPartnerAddress,to_Supplier',
  $filter: 'Country eq "VN"'
});
```

---

### `transformer.ts`

Transforms SAP data structures into Pericles `OrganizationContext` format.

**Key Functions:**
- `transformSAPDataToOrganizationContext()` - Main transformation
- `validateOrganizationContext()` - Data quality checks

**Example:**
```typescript
import { transformSAPDataToOrganizationContext } from './transformer';

const contextData = transformSAPDataToOrganizationContext(
  suppliersResponse,  // SAP Business Partners
  plantsResponse,     // SAP Plants
  shippingLanesResponse
);

// Returns:
// {
//   plants: [...],
//   warehouses: [...],
//   suppliers: [...],
//   shipping_lanes: [...],
//   risk_preferences: {...}
// }
```

---

### `sync-service.ts`

Sync service for scheduled ERP data updates.

**Functions:**
- `syncSAPDataForOrganization(orgId)` - Sync single org
- `syncSAPDataForAllOrganizations()` - Sync all active orgs
- `testSAPConnection()` - Health check

**Example:**
```typescript
import { syncSAPDataForOrganization } from './sync-service';

const result = await syncSAPDataForOrganization(
  '550e8400-e29b-41d4-a716-446655440000',
  { verbose: true }
);

console.log(result.records_synced);
// { plants: 1, warehouses: 4, suppliers: 3, shipping_lanes: 4 }
```

---

## Environment Variables

Required in `backend/.env`:

```bash
# SAP S/4HANA Cloud Configuration
SAP_S4HANA_BASE_URL=https://my123456-api.s4hana.ondemand.com
SAP_S4HANA_CLIENT_ID=your-oauth-client-id
SAP_S4HANA_CLIENT_SECRET=your-oauth-client-secret
SAP_S4HANA_TIMEOUT=30000
SAP_S4HANA_USE_MOCK=true  # false for production
```

---

## Testing

### Unit Tests (Future)

```bash
npm run test:sap
```

### Integration Test

```bash
# Mock mode (no SAP credentials required)
DATABASE_URL="postgresql://..." \
npx tsx src/scripts/sync-sap-erp.ts \
  --org-id=550e8400-e29b-41d4-a716-446655440000 \
  --dry-run \
  --verbose
```

### Health Check

```bash
npx tsx src/scripts/sync-sap-erp.ts --test
```

---

## Deployment

### Scheduled Sync (Cron)

```bash
# Every 30 minutes
*/30 * * * * cd /app/backend && npx tsx src/scripts/sync-sap-erp.ts --all
```

### PM2 Ecosystem

```javascript
// ecosystem.config.js
{
  name: 'sap-sync',
  script: 'src/scripts/sync-sap-erp.ts',
  cron_restart: '*/30 * * * *',
  autorestart: false
}
```

---

## API Reference

### SAP Client Methods

```typescript
// Get all business partners (suppliers/customers)
await sapClient.getBusinessPartners(options?: SAPQueryOptions)

// Get single business partner
await sapClient.getBusinessPartner(businessPartnerId: string)

// Get all plants
await sapClient.getPlants(options?: SAPQueryOptions)

// Get single plant
await sapClient.getPlant(plantId: string)

// Get materials
await sapClient.getMaterials(options?: SAPQueryOptions)

// Get material stock by plant
await sapClient.getMaterialStock(plantId: string)

// Get shipping lanes
await sapClient.getShippingLanes(options?: SAPQueryOptions)

// Health check
await sapClient.healthCheck()
```

### OData Query Options

```typescript
interface SAPQueryOptions {
  $filter?: string;    // "Country eq 'US'"
  $select?: string;    // "BusinessPartner,BusinessPartnerName"
  $expand?: string;    // "to_BusinessPartnerAddress"
  $top?: number;       // 10
  $skip?: number;      // 0
  $orderby?: string;   // "BusinessPartnerName asc"
  $count?: boolean;    // true
  $format?: 'json';    // 'json' | 'xml'
}
```

---

## Troubleshooting

### Common Issues

**Problem:** "Can't reach database server at postgres:5432"

**Solution:** Override DATABASE_URL:
```bash
DATABASE_URL="postgresql://...@localhost:5432/..." \
npx tsx src/scripts/sync-sap-erp.ts --test
```

**Problem:** "OAuth authentication failed"

**Solution:** Verify SAP credentials in `.env`

**Problem:** "Supplier has invalid coordinates"

**Solution:** Add geocoding to Business Partner address in SAP

---

## Support

- 📖 **Documentation:** See `/backend/docs/SAP_*.md`
- 🐛 **Issues:** GitHub Issues
- 💬 **Questions:** Team Slack #supply-chain-tech

---

## License

Proprietary - Levi Strauss & Co.
