# Mock Shipment Generator

Generate realistic mock shipment data for testing the Pericles Monitoring Agent against various supply chain risk scenarios.

## Overview

The mocker creates test data for Levi Strauss & Co. including:
- **Suppliers** in high-risk regions (China, Vietnam, Bangladesh, India, Philippines, Taiwan, Turkey)
- **Carriers** (Maersk, MSC, CMA CGM, COSCO, Evergreen, etc.)
- **Shipments** with configurable risk scenarios routed through realistic ports

All generated data uses a configurable ID prefix (`mock-` by default) for easy identification and cleanup.

## Prerequisites

1. PostgreSQL database running (via Docker or Neon)
2. Environment variables configured in `backend/.env`
3. Prisma client generated: `npm run prisma:generate`
4. Database migrations applied: `npm run prisma:migrate:dev`

## Quick Start

```bash
cd backend

# Create 50 mock shipments (default)
npm run mock:create

# Check what was created
npm run mock:status

# Clean up when done
npm run mock:reset
```

## Commands

### Create Mock Data

```bash
npm run mock:create
```

Creates suppliers, carriers, and shipments in the database.

**Options:**

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--count` | `-c` | Number of shipments to generate | 50 |
| `--scenarios` | `-s` | Comma-separated risk scenarios | all |
| `--prefix` | `-p` | ID prefix for generated records | `mock-` |
| `--org` | `-o` | Organization UUID | Levi Strauss ID |

**Examples:**

```bash
# Create 100 shipments
npm run mock:create -- --count 100

# Create only typhoon and flood risk shipments
npm run mock:create -- --scenarios typhoon,flood

# Create with custom prefix for a specific test run
npm run mock:create -- --prefix test-2025-01- --count 25

# Combine options
npm run mock:create -- --count 200 --scenarios typhoon,earthquake,port_congestion
```

### Check Status

```bash
npm run mock:status
```

Displays current mock data statistics:
- Number of suppliers, carriers, shipments
- Breakdown by risk scenario

### Reset (Delete) Mock Data

```bash
npm run mock:reset
```

Deletes all records matching the ID prefix. Safe to run multiple times.

**With custom prefix:**

```bash
npm run mock:reset -- --prefix test-2025-01-
```

### Help

```bash
npm run mock:help
```

Displays detailed usage information.

## Risk Scenarios

The mocker supports 10 risk scenarios that map to the Monitoring Agent's detection categories:

| Scenario | Code | Affected Regions | Risk Factors |
|----------|------|------------------|--------------|
| Typhoon | `typhoon` | Philippines, Taiwan, Japan, China coastal | Seasonal storms, port closures |
| Earthquake | `earthquake` | Japan, Taiwan, California, Turkey | Seismic activity, infrastructure damage |
| Port Congestion | `port_congestion` | LA, Long Beach, Shanghai, Ningbo, Chittagong | Delays, container shortages |
| Labor Strike | `labor_strike` | US West Coast, India, Bangladesh | Work stoppages, port slowdowns |
| Geopolitical | `geopolitical` | Taiwan Strait, Middle East, Turkey | Political instability, sanctions |
| Pandemic | `pandemic` | Vietnam, Bangladesh | Health alerts, factory closures |
| Cyber Risk | `cyber_risk` | Shenzhen (tech exports) | Cyber attacks, data breaches |
| Tariff Risk | `tariff_risk` | US-China routes | Trade policy changes, duties |
| Piracy | `piracy` | Malacca Strait, Gulf of Aden | Maritime security threats |
| Flood | `flood` | Bangladesh, Vietnam, India, Rotterdam | Seasonal flooding, logistics disruption |

### Testing Specific Scenarios

```bash
# Test typhoon detection (Asia-Pacific routes)
npm run mock:create -- --scenarios typhoon --count 30

# Test labor strike detection (port workers)
npm run mock:create -- --scenarios labor_strike --count 20

# Test multiple overlapping risks
npm run mock:create -- --scenarios typhoon,port_congestion,tariff_risk --count 50
```

## Generated Data Structure

### Suppliers (12 total when using all scenarios)

Located in high-risk manufacturing regions:
- **China**: Guangzhou, Shenzhen, Ningbo (typhoon, tariff, cyber risks)
- **Vietnam**: Ho Chi Minh City, Hanoi (flood, pandemic, labor risks)
- **Bangladesh**: Dhaka, Chittagong (flood, labor, port congestion)
- **India**: Mumbai, Chennai (flood, labor risks)
- **Philippines**: Manila (typhoon, earthquake risks)
- **Taiwan**: Taipei (typhoon, earthquake, geopolitical risks)
- **Turkey**: Istanbul (geopolitical, earthquake risks)

### Carriers (10 total)

Major shipping lines with vessel names:
- Maersk (MAEU) - High reliability
- MSC (MSCU) - High reliability
- CMA CGM (CMDU) - High reliability
- COSCO (COSU) - Medium reliability
- Evergreen (EGLV) - Medium reliability
- Hapag-Lloyd (HLCU) - High reliability
- ONE (ONEY) - Medium reliability
- Yang Ming (YMLU) - Medium reliability
- HMM (HDMU) - Medium reliability
- ZIM (ZIMU) - Low reliability

### Shipping Routes (8 configured)

| Route | Transit Days | Primary Risks |
|-------|--------------|---------------|
| China-LAX Express | 14 | Typhoon, port congestion, tariffs |
| Vietnam-Long Beach | 21 | Flood, pandemic, piracy |
| Bangladesh-NYC | 35 | Flood, labor strike, congestion |
| Taiwan-Oakland | 16 | Typhoon, earthquake, geopolitical |
| India-Rotterdam | 28 | Flood, labor strike, piracy |
| Philippines-Savannah | 25 | Typhoon, earthquake, flood |
| Shenzhen-LA Tech | 15 | Typhoon, cyber risk, tariffs |
| Ningbo-Long Beach | 14 | Typhoon, port congestion, tariffs |

### Shipments

Each shipment includes:
- **BOL number**: Realistic format (e.g., `MAEU8K4F2X9A`)
- **Container IDs**: Valid format (e.g., `MSKU1234567-8`)
- **Products**: Levi's product catalog (jeans, jackets, shirts, etc.)
- **HS codes**: Accurate apparel/textile codes
- **Value**: Configurable range ($10,000 - $500,000 USD)
- **Dates**: Mix of past, current, and future arrivals
- **Risk metadata**: Embedded in `shipping_route` field as `[RISK:scenario1,scenario2]`

## Integration with Monitoring Agent

After generating mock data, test the Monitoring Agent:

```bash
# 1. Generate mock shipments with specific risks
npm run mock:create -- --scenarios typhoon,flood --count 50

# 2. Start Mastra dev server
npm run dev

# 3. In Mastra Studio (http://localhost:4111), run the Monitoring Agent
#    with organization_id: 550e8400-e29b-41d4-a716-446655440000

# 4. The agent should detect events near supplier/shipment locations
```

### Testing Workflow

1. **Create baseline data**:
   ```bash
   npm run mock:create -- --count 100
   ```

2. **Run monitoring cycle** via Mastra Studio or API

3. **Check for detected events** in the `Event` table:
   ```bash
   npm run prisma:studio
   ```

4. **Test specific scenario**:
   ```bash
   npm run mock:reset
   npm run mock:create -- --scenarios typhoon --count 30
   # Run monitoring agent focused on weather/disaster tool
   ```

5. **Clean up**:
   ```bash
   npm run mock:reset
   ```

## Database Tables Affected

| Table | Records Created | Notes |
|-------|-----------------|-------|
| `Organization` | 1 | Levi Strauss (created if not exists) |
| `Supplier` | 6-12 | Based on selected scenarios |
| `Carrier` | 10 | All carriers always created |
| `Shipment` | Configurable | Default 50 |
| `OrganizationContext` | 1 | Updated with supplier locations |

## Troubleshooting

### "Organization not found" error

The mocker creates the Levi Strauss organization automatically. If you see this error:
```bash
npm run prisma:migrate:dev
npm run mock:create
```

### Duplicate key errors

Reset existing mock data before creating new data:
```bash
npm run mock:reset
npm run mock:create
```

### "No suppliers or carriers found"

Ensure the create command completed successfully. Check:
```bash
npm run mock:status
```

### Type errors when running

Ensure Prisma client is generated:
```bash
npm run prisma:generate
```

## Advanced Usage

### Direct CLI Access

For more control, run the script directly:

```bash
npx tsx src/scripts/mocker/index.ts create --count 100 --scenarios typhoon,flood
npx tsx src/scripts/mocker/index.ts status
npx tsx src/scripts/mocker/index.ts reset
```

### Programmatic Usage

Import the generator in your own scripts:

```typescript
import { MockShipmentGenerator } from './src/scripts/mocker/generator';

const generator = new MockShipmentGenerator({
  shipmentCount: 100,
  riskScenarios: ['typhoon', 'flood'],
  idPrefix: 'my-test-',
});

await generator.generate();
// ... run tests ...
await generator.reset();
await generator.disconnect();
```

### Custom Configuration

Edit `src/scripts/mocker/types.ts` to modify defaults:

```typescript
export const DEFAULT_MOCKER_CONFIG: MockerConfig = {
  shipmentCount: 50,
  riskScenarios: [],  // Empty = all scenarios
  statusDistribution: {
    in_transit: 40,   // 40% in transit
    at_port: 20,      // 20% at port
    customs_hold: 10, // 10% held at customs
    delivered: 20,    // 20% delivered
    delayed: 10,      // 10% delayed
  },
  dateRange: {
    pastDays: 30,     // Arrivals up to 30 days ago
    futureDays: 60,   // Arrivals up to 60 days out
  },
  valueRange: {
    min: 10000,       // Minimum shipment value USD
    max: 500000,      // Maximum shipment value USD
  },
  idPrefix: 'mock-',
  organizationId: '550e8400-e29b-41d4-a716-446655440000',
};
```

## File Structure

```
backend/src/scripts/mocker/
├── index.ts      # CLI entry point
├── generator.ts  # Core generation logic
├── data.ts       # Mock data (ports, suppliers, carriers, routes)
├── types.ts      # TypeScript interfaces and config
└── README.md     # This file
```
