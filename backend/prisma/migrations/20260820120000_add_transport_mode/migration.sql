-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('MARITIME', 'RAIL', 'ROAD', 'AIR');

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "mode_of_transport" "TransportMode" NOT NULL DEFAULT 'MARITIME';