-- CreateIndex
--
-- The index `fanOutOffers` leans on: the bounding box is a range over both
-- columns, run once per publish against every technician in the country.
CREATE INDEX "users_latitude_longitude_idx" ON "users"("latitude", "longitude");
