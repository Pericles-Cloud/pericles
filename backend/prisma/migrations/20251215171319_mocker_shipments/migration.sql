/*
  Warnings:

  - Made the column `total_shipments` on table `Carrier` required. This step will fail if there are existing NULL values in that column.
  - Made the column `total_shipments` on table `Supplier` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Carrier" ALTER COLUMN "total_shipments" SET NOT NULL;

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "total_shipments" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Carrier_scac_code_idx" ON "Carrier"("scac_code");
