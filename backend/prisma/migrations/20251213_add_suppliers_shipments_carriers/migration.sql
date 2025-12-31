-- Add columns to Organization table for Levi Strauss data
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "address_line1" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "zip_code" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "phone_number" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "most_recent_shipment_date" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "database_updated_date" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "customer_type" TEXT;

-- Create Suppliers table
CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "website" TEXT,
    "contact_info" TEXT,
    "country" TEXT,
    "country_code" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "total_shipments" INTEGER DEFAULT 0,
    "destination_ports" TEXT[],
    "departure_ports" TEXT[],
    "hs_codes" TEXT[],
    "notify_party_name" TEXT,
    "notify_party_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- Create Carriers table
CREATE TABLE IF NOT EXISTS "Carrier" (
    "id" TEXT NOT NULL,
    "scac_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "total_shipments" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- Create Shipments table
CREATE TABLE IF NOT EXISTS "Shipment" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "carrier_id" TEXT,
    "bol_number" TEXT NOT NULL,
    "master_bol_number" TEXT,
    "containers_count" INTEGER,
    "shipping_route" TEXT,
    "value_usd" DOUBLE PRECISION,
    "arrival_date" TIMESTAMP(3),
    "estimated_arrival_date" TIMESTAMP(3),
    "destination_port" TEXT,
    "destination_port_code" TEXT,
    "departure_port" TEXT,
    "departure_port_code" TEXT,
    "last_visit_foreign_port" TEXT,
    "vessel_name" TEXT,
    "vessel_code" TEXT,
    "voyage" TEXT,
    "container_ids" TEXT[],
    "container_sizes" TEXT[],
    "container_types" TEXT[],
    "hs_codes" TEXT[],
    "hs_code_descriptions" TEXT[],
    "product_description" TEXT,
    "product_description_raw" TEXT,
    "quantity" DOUBLE PRECISION,
    "quantity_unit" TEXT,
    "teu" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "marks_numbers" TEXT,
    "marks_numbers_raw" TEXT,
    "notify_party_name" TEXT,
    "notify_party_address" TEXT,
    "notify_party_country_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- Create indexes for Suppliers
CREATE INDEX IF NOT EXISTS "Supplier_organization_id_idx" ON "Supplier"("organization_id");
CREATE INDEX IF NOT EXISTS "Supplier_country_code_idx" ON "Supplier"("country_code");
CREATE INDEX IF NOT EXISTS "Supplier_name_idx" ON "Supplier"("name");

-- Create indexes for Carriers
CREATE UNIQUE INDEX IF NOT EXISTS "Carrier_scac_code_key" ON "Carrier"("scac_code");
CREATE INDEX IF NOT EXISTS "Carrier_name_idx" ON "Carrier"("name");

-- Create indexes for Shipments
CREATE INDEX IF NOT EXISTS "Shipment_organization_id_idx" ON "Shipment"("organization_id");
CREATE INDEX IF NOT EXISTS "Shipment_supplier_id_idx" ON "Shipment"("supplier_id");
CREATE INDEX IF NOT EXISTS "Shipment_carrier_id_idx" ON "Shipment"("carrier_id");
CREATE INDEX IF NOT EXISTS "Shipment_bol_number_idx" ON "Shipment"("bol_number");
CREATE INDEX IF NOT EXISTS "Shipment_arrival_date_idx" ON "Shipment"("arrival_date");
CREATE INDEX IF NOT EXISTS "Shipment_destination_port_idx" ON "Shipment"("destination_port");
CREATE INDEX IF NOT EXISTS "Shipment_departure_port_idx" ON "Shipment"("departure_port");

-- Add foreign keys
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_carrier_id_fkey"
    FOREIGN KEY ("carrier_id") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
