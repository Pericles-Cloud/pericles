-- Baseline a previously db-pushed change into migration history.
-- Content-dedup unique index on Event; already present in existing databases
-- (applied out-of-band via `prisma db push`), created normally on fresh ones.

-- CreateIndex
CREATE UNIQUE INDEX "Event_organization_id_title_source_type_key" ON "Event"("organization_id", "title", "source", "type");
