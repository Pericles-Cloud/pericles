-- Test Organization Setup for Monitoring Agent
-- This script creates a test organization with sample ERP data

-- Create test organization
INSERT INTO "Organization" (id, name, email_domain, is_root, created_at, updated_at)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'Test Organization',
  'test-org.com',
  false,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Create organization context with sample supply chain data
INSERT INTO "OrganizationContext" (
  id,
  organization_id,
  plants,
  warehouses,
  suppliers,
  shipping_lanes,
  monitored_risk_types,
  geographic_radius_km,
  severity_threshold,
  strategic_documents,
  last_erp_sync,
  created_at,
  updated_at
) VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  '550e8400-e29b-41d4-a716-446655440000',
  -- Plants (JSON)
  '[
    {
      "plant_id": "plant-001",
      "name": "Shanghai Manufacturing Plant",
      "location": {
        "city": "Shanghai",
        "country": "China",
        "latitude": 31.2304,
        "longitude": 121.4737
      },
      "criticality": "high"
    },
    {
      "plant_id": "plant-002",
      "name": "Los Angeles Assembly Plant",
      "location": {
        "city": "Los Angeles",
        "country": "United States",
        "latitude": 34.0522,
        "longitude": -118.2437
      },
      "criticality": "medium"
    }
  ]'::jsonb,
  -- Warehouses (JSON)
  '[
    {
      "warehouse_id": "wh-001",
      "name": "Rotterdam Distribution Center",
      "location": {
        "city": "Rotterdam",
        "country": "Netherlands",
        "latitude": 51.9225,
        "longitude": 4.47917
      }
    },
    {
      "warehouse_id": "wh-002",
      "name": "Singapore Logistics Hub",
      "location": {
        "city": "Singapore",
        "country": "Singapore",
        "latitude": 1.3521,
        "longitude": 103.8198
      }
    }
  ]'::jsonb,
  -- Suppliers (JSON)
  '[
    {
      "supplier_id": "sup-001",
      "name": "Taiwan Semiconductor Components",
      "location": {
        "city": "Hsinchu",
        "country": "Taiwan",
        "latitude": 24.8138,
        "longitude": 120.9675
      },
      "tier": 1
    },
    {
      "supplier_id": "sup-002",
      "name": "Vietnam Electronics Manufacturing",
      "location": {
        "city": "Ho Chi Minh City",
        "country": "Vietnam",
        "latitude": 10.8231,
        "longitude": 106.6297
      },
      "tier": 2
    }
  ]'::jsonb,
  -- Shipping Lanes (JSON)
  '[
    {
      "lane_id": "lane-001",
      "origin": "Shanghai",
      "destination": "Los Angeles",
      "key_ports": ["Shanghai", "Tokyo", "Los Angeles"]
    },
    {
      "lane_id": "lane-002",
      "origin": "Singapore",
      "destination": "Rotterdam",
      "key_ports": ["Singapore", "Suez Canal", "Rotterdam"]
    }
  ]'::jsonb,
  -- Monitored Risk Types (empty = monitor all)
  ARRAY[]::text[],
  -- Geographic Radius (100km)
  100.0,
  -- Severity Threshold (0.5)
  0.5,
  -- Strategic Documents (JSON)
  '{
    "annual_plan": "2024_supply_chain_plan.pdf",
    "risk_policy": "risk_management_policy_v2.pdf"
  }'::jsonb,
  -- Last ERP Sync
  NOW(),
  -- Timestamps
  NOW(),
  NOW()
) ON CONFLICT (organization_id) DO UPDATE SET
  plants = EXCLUDED.plants,
  warehouses = EXCLUDED.warehouses,
  suppliers = EXCLUDED.suppliers,
  shipping_lanes = EXCLUDED.shipping_lanes,
  updated_at = NOW();

-- Display test organization info
SELECT
  o.id as organization_id,
  o.name,
  jsonb_array_length(oc.plants) as plants_count,
  jsonb_array_length(oc.warehouses) as warehouses_count,
  jsonb_array_length(oc.suppliers) as suppliers_count,
  oc.geographic_radius_km,
  oc.severity_threshold
FROM "Organization" o
JOIN "OrganizationContext" oc ON o.id = oc.organization_id
WHERE o.id = '550e8400-e29b-41d4-a716-446655440000';
