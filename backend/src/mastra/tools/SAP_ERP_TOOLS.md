# SAP S/4HANA Cloud ERP Data Tools for Mastra Agents

## Overview

This document describes the SAP S/4HANA Cloud ERP data tools that can be used by Mastra agents to fetch real-time supply chain master data directly from SAP APIs.

**File**: `backend/src/mastra/tools/sap-erp-data-tool.ts`

---

## Purpose

These tools enable Mastra agents to access fresh ERP data from SAP S/4HANA Cloud without waiting for the scheduled sync. This is useful for:

1. **Real-time Verification**: Verify supplier locations during event monitoring
2. **On-Demand Queries**: Fetch plant capacity data when assessing impact
3. **Fresh Data Access**: Get current inventory levels for risk analysis
4. **Dynamic Filtering**: Query specific subsets of ERP data based on agent needs

---

## Available Tools

### 1. `sapGetSuppliersT`

**ID**: `sap-get-suppliers`

**Purpose**: Fetch supplier master data from SAP S/4HANA Cloud including locations, tiers, criticality flags, and risk scores.

**Input Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `country_filter` | string | No | - | Filter suppliers by ISO country code (e.g., "US", "CN") |
| `critical_only` | boolean | No | false | Return only critical (Tier 1) suppliers |
| `max_results` | number | No | 50 | Maximum number of suppliers to return (1-100) |

**Output**:

```typescript
{
  suppliers: Array<{
    supplier_id: string;
    name: string;
    location: {
      name: string;
      latitude: number;
      longitude: number;
      country: string;
    };
    tier: number; // 1-3
    critical: boolean;
    risk_score?: number; // 0.0-1.0
  }>;
  total_count: number;
  data_source: 'sap_production' | 'sap_mock';
  timestamp: string; // ISO 8601
}
```

**Example Usage**:

```typescript
// In a Mastra agent
const result = await sapGetSuppliersT.execute({
  context: {
    country_filter: 'VN', // Vietnam
    critical_only: true,
    max_results: 10
  }
});

console.log(`Found ${result.suppliers.length} critical suppliers in Vietnam`);
```

**SAP API**: `API_BUSINESS_PARTNER` - `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner`

---

### 2. `sapGetPlantsT`

**ID**: `sap-get-plants`

**Purpose**: Fetch plant and warehouse data from SAP S/4HANA Cloud including locations, capacity, and utilization metrics.

**Input Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `plant_type` | enum | No | 'all' | Filter by facility type: 'manufacturing', 'warehouse', or 'all' |
| `country_filter` | string | No | - | Filter by ISO country code |
| `max_results` | number | No | 50 | Maximum number of plants to return (1-100) |

**Output**:

```typescript
{
  plants: Array<{
    plant_id: string;
    name: string;
    location: {
      name: string;
      latitude: number;
      longitude: number;
      country: string;
    };
    plant_type: 'manufacturing' | 'warehouse';
    capacity?: number; // Units
    utilization?: number; // 0-100%
  }>;
  total_count: number;
  data_source: 'sap_production' | 'sap_mock';
  timestamp: string;
}
```

**Example Usage**:

```typescript
// Get all manufacturing plants in the US
const result = await sapGetPlantsT.execute({
  context: {
    plant_type: 'manufacturing',
    country_filter: 'US',
    max_results: 20
  }
});

// Check capacity
result.plants.forEach(plant => {
  if (plant.utilization && plant.utilization > 90) {
    console.log(`${plant.name} is at ${plant.utilization}% capacity - HIGH RISK`);
  }
});
```

**SAP API**: `API_PLANT_SRV` (or custom Z-API) - `/sap/opu/odata/sap/API_PLANT_SRV/A_Plant`

---

### 3. `sapGetMaterialStockTool`

**ID**: `sap-get-material-stock`

**Purpose**: Fetch real-time material stock levels from SAP S/4HANA Cloud for a specific plant.

**Input Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `plant_id` | string | **Yes** | - | SAP Plant ID (e.g., "1000") |
| `material_filter` | string | No | - | Filter by material number (optional) |
| `max_results` | number | No | 50 | Maximum number of stock records (1-100) |

**Output**:

```typescript
{
  stock: Array<{
    material: string;
    plant: string;
    quantity: number;
    unit: string; // e.g., "EA", "KG"
    stock_value?: number;
    currency?: string; // e.g., "USD"
  }>;
  plant_id: string;
  total_count: number;
  data_source: 'sap_production' | 'sap_mock';
  timestamp: string;
}
```

**Example Usage**:

```typescript
// Check stock at San Francisco DC (plant 1000)
const result = await sapGetMaterialStockTool.execute({
  context: {
    plant_id: '1000',
    material_filter: '501', // 501 Original Fit Jeans
    max_results: 10
  }
});

const totalStock = result.stock.reduce((sum, item) => sum + item.quantity, 0);
console.log(`Total stock of 501 jeans: ${totalStock} units`);
```

**SAP API**: `API_MATERIAL_STOCK_SRV` - `/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MaterialStock`

---

### 4. `sapGetShippingLanesTool`

**ID**: `sap-get-shipping-lanes`

**Purpose**: Fetch active shipping routes with carriers, transit times, and waypoints.

**Input Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `origin_plant` | string | No | - | Filter by origin plant ID |
| `destination_plant` | string | No | - | Filter by destination plant ID |
| `mode` | enum | No | 'all' | Filter by shipment mode: 'air', 'ocean', 'truck', 'rail', or 'all' |
| `active_only` | boolean | No | true | Return only active lanes |
| `max_results` | number | No | 50 | Maximum number of lanes (1-100) |

**Output**:

```typescript
{
  shipping_lanes: Array<{
    lane_id: string;
    origin: {
      plant_id: string;
      name: string;
      latitude: number;
      longitude: number;
    };
    destination: {
      plant_id: string;
      name: string;
      latitude: number;
      longitude: number;
    };
    mode: string; // 'air', 'ocean', 'truck', 'rail'
    carrier?: string;
    transit_days: number;
    active: boolean;
  }>;
  total_count: number;
  data_source: 'sap_production' | 'sap_mock';
  timestamp: string;
}
```

**Example Usage**:

```typescript
// Find all ocean shipping lanes from Shanghai
const result = await sapGetShippingLanesTool.execute({
  context: {
    origin_plant: '5000', // Shanghai DC
    mode: 'ocean',
    active_only: true,
    max_results: 10
  }
});

result.shipping_lanes.forEach(lane => {
  console.log(`${lane.origin.name} → ${lane.destination.name}: ${lane.transit_days} days via ${lane.carrier}`);
});
```

**SAP API**: `Z_SHIPPING_LANES_SRV` (Custom) - `/sap/opu/odata/sap/Z_SHIPPING_LANES_SRV/ShippingLanes`

---

## Configuration

### Environment Variables

Required in `backend/.env`:

```bash
# SAP S/4HANA Cloud Configuration
SAP_S4HANA_BASE_URL=https://my123456-api.s4hana.ondemand.com
SAP_S4HANA_CLIENT_ID=your-oauth-client-id
SAP_S4HANA_CLIENT_SECRET=your-oauth-client-secret
SAP_S4HANA_TIMEOUT=30000                # Request timeout (ms)
SAP_S4HANA_USE_MOCK=true                # Use mock API (false for production)
```

### Mock vs. Production Mode

**Mock Mode** (`SAP_S4HANA_USE_MOCK=true`):
- Uses hardcoded Levi Strauss data from `mock-api.ts`
- No SAP credentials required
- Fast responses (~200ms)
- Returns `data_source: 'sap_mock'`

**Production Mode** (`SAP_S4HANA_USE_MOCK=false`):
- Connects to real SAP S/4HANA Cloud tenant
- Requires valid OAuth credentials
- Subject to network latency and SAP rate limits
- Returns `data_source: 'sap_production'`

---

## Integration with Monitoring Agent

### Example: Dynamic Supplier Verification

```typescript
// Inside monitoring-agent.ts

export const monitoringAgent = new Agent({
  name: 'Monitoring Agent',
  instructions: `
    When a typhoon is detected in Taiwan:
    1. Use sapGetSuppliersT to get all suppliers in Taiwan
    2. Calculate distance from typhoon to each supplier
    3. Publish incidents for suppliers within 100km
  `,
  tools: {
    // Existing tools
    erpContextTool,
    incidentLookupTool,

    // NEW: SAP real-time tools
    sapGetSuppliersT,
    sapGetPlantsT,
    sapGetMaterialStockTool,
    sapGetShippingLanesTool,

    // Monitoring tools
    weatherDisasterMonitorTool,
    // ... other tools
  },
  // ... rest of config
});
```

### Example Agent Workflow

```typescript
// Agent detects typhoon in Taiwan
const typhoonEvent = {
  title: "Typhoon Haikui approaching Taiwan",
  location: { latitude: 24.5, longitude: 121.0 },
  severity: 0.8
};

// Step 1: Get suppliers in Taiwan using SAP tool
const suppliersResult = await sapGetSuppliersT.execute({
  context: {
    country_filter: 'TW', // Taiwan
    critical_only: true
  }
});

// Step 2: Filter by proximity
const affectedSuppliers = suppliersResult.suppliers.filter(supplier => {
  const distance = calculateDistance(
    typhoonEvent.location.latitude,
    typhoonEvent.location.longitude,
    supplier.location.latitude,
    supplier.location.longitude
  );
  return distance <= 100; // 100km radius
});

// Step 3: Check stock levels at affected suppliers
for (const supplier of affectedSuppliers) {
  const stockResult = await sapGetMaterialStockTool.execute({
    context: {
      plant_id: supplier.supplier_id,
      max_results: 20
    }
  });

  // Assess inventory risk
  const totalValue = stockResult.stock.reduce((sum, item) =>
    sum + (item.stock_value || 0), 0
  );

  console.log(`Supplier ${supplier.name} has $${totalValue} inventory at risk`);
}

// Step 4: Publish incident
publishIncident({
  ...typhoonEvent,
  affected_suppliers: affectedSuppliers.map(s => s.name),
  estimated_inventory_value: totalValue
});
```

---

## Best Practices

### 1. Use Timeouts

All tools have built-in 30-second timeouts to prevent hanging requests:

```typescript
// Built into each tool
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);
```

### 2. Handle Errors Gracefully

```typescript
try {
  const result = await sapGetSuppliersT.execute({ context: { ... } });
  // Use result
} catch (error) {
  console.error('SAP API error:', error);
  // Fallback: use cached data from erpContextTool
  const cachedData = await erpContextTool.execute({ context: { organization_id } });
}
```

### 3. Filter Early

Use SAP's OData filters to reduce network payload:

```typescript
// Good: Filter at API level
sapGetSuppliersT.execute({
  context: {
    country_filter: 'US',
    critical_only: true,
    max_results: 10 // Only fetch what you need
  }
});

// Bad: Fetch all and filter client-side
const all = await sapGetSuppliersT.execute({ context: { max_results: 100 } });
const filtered = all.suppliers.filter(s => s.country === 'US' && s.critical);
```

### 4. Combine with Cached Data

For performance, use SAP tools for real-time verification and `erpContextTool` for bulk data:

```typescript
// Get cached organization footprint (fast)
const erpContext = await erpContextTool.execute({ context: { organization_id } });

// Verify specific supplier in real-time (slower but fresh)
const liveSupplier = await sapGetSuppliersT.execute({
  context: {
    country_filter: 'VN',
    critical_only: true,
    max_results: 1
  }
});
```

---

## Data Transformation

The tools automatically transform SAP OData structures into simplified formats:

### SAP Business Partner → Supplier

```typescript
// SAP Input
{
  BusinessPartner: "0000100001",
  BusinessPartnerName: "Saitex International",
  to_BusinessPartnerAddress: [{
    Country: "VN",
    CityName: "Ho Chi Minh City",
    Latitude: "10.8231",
    Longitude: "106.6297"
  }],
  to_Supplier: {
    SupplierTier: 1,
    IsCriticalSupplier: true,
    SupplierRiskScore: 0.25
  }
}

// Tool Output
{
  supplier_id: "0000100001",
  name: "Saitex International",
  location: {
    name: "Ho Chi Minh City",
    latitude: 10.8231, // Parsed to number
    longitude: 106.6297,
    country: "VN"
  },
  tier: 1,
  critical: true,
  risk_score: 0.25
}
```

---

## Security

### Server-Side Only

All tools execute server-side only. SAP credentials are never exposed to the client.

```typescript
// ✓ GOOD: Tools used in Mastra agents (server-side)
export const monitoringAgent = new Agent({
  tools: { sapGetSuppliersT, sapGetPlantsT }
});

// ✗ BAD: Never expose SAP tools to client-side code
```

### OAuth 2.0 Authentication

Production mode uses OAuth 2.0 with automatic token refresh:

```typescript
// Handled by sapClient.authenticate()
const token = await sapClient.authenticate(); // Fetches/refreshes token
```

### No Credentials in Code

All credentials are stored in environment variables:

```bash
# ✓ GOOD: Environment variables
SAP_S4HANA_CLIENT_ID=your-client-id

# ✗ BAD: Hardcoded credentials
const clientId = 'sk-12345...'; // NEVER do this
```

---

## Testing

### Unit Test Example

```typescript
import { sapGetSuppliersT } from './sap-erp-data-tool';

describe('sapGetSuppliersT', () => {
  it('should fetch suppliers from mock API', async () => {
    process.env.SAP_S4HANA_USE_MOCK = 'true';

    const result = await sapGetSuppliersT.execute({
      context: {
        country_filter: 'VN',
        critical_only: true,
        max_results: 10
      }
    });

    expect(result.suppliers.length).toBeGreaterThan(0);
    expect(result.data_source).toBe('sap_mock');
    expect(result.suppliers[0]).toHaveProperty('supplier_id');
    expect(result.suppliers[0]).toHaveProperty('location');
  });
});
```

### Integration Test

```bash
# Test with mock SAP API
SAP_S4HANA_USE_MOCK=true npx tsx test-sap-tools.ts
```

---

## Troubleshooting

### Error: "SAP API error: Request timeout after 30 seconds"

**Cause**: SAP API call exceeded 30-second timeout

**Solution**:
1. Check network connectivity to SAP
2. Reduce `max_results` parameter
3. Check SAP system status
4. Increase timeout in code (if justified)

### Error: "OAuth authentication failed: 401 Unauthorized"

**Cause**: Invalid SAP credentials

**Solution**:
1. Verify `SAP_S4HANA_CLIENT_ID` in `.env`
2. Verify `SAP_S4HANA_CLIENT_SECRET` in `.env`
3. Check Communication Arrangement is active in SAP
4. Verify user has required authorizations

### Error: "Business Partner X is not a supplier"

**Cause**: Business Partner record missing `to_Supplier` relationship

**Solution**:
1. Verify supplier is marked as supplier in SAP (BP type)
2. Check `$expand=to_Supplier` is included in API call
3. Update SAP Business Partner master data

---

## Performance

| Operation | Mock Mode | Production Mode |
|-----------|-----------|-----------------|
| Get Suppliers (10) | ~200ms | ~500-1500ms |
| Get Plants (10) | ~200ms | ~500-1500ms |
| Get Material Stock | ~200ms | ~800-2000ms |
| Get Shipping Lanes | ~200ms | ~600-1800ms |

**Note**: Production times depend on network latency, SAP system load, and data volume.

---

## References

- **SAP S/4HANA Cloud APIs**: https://api.sap.com/package/SAPS4HANACloud/odata
- **SAP API Guide**: https://www.apideck.com/blog/guide-to-sap-4-hana-rest-and-soap-api
- **Business Partner API**: https://blogs.sap.com/2020/09/11/how-access-business-partner-odata-service-in-sap-s-4hana-cloud/
- **Technical Integration Docs**: `backend/docs/SAP_S4HANA_INTEGRATION.md`
- **SAP Usage Guide**: `backend/docs/SAP_USAGE_GUIDE.md`

---

**Last Updated**: December 14, 2025
**Version**: 1.0.0
