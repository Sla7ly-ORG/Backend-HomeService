import { ApiError } from "./errors.js";

/**
 * TASK 10 - "which technicians are near this job?", in two functions.
 *
 * Arithmetic only: no Prisma, no `req`/`res`, nothing async. Coordinates arrive
 * here as plain numbers, so convert at the edge - a Prisma `Decimal` becomes
 * `Number(row.serviceLatitude)` in the service, not in here.
 */

/** A place on the map. Degrees, not radians. */
export type Point = { lat: number; lng: number };

/** The four degree bounds of a square that contains a circle of `radiusKm`. */
export type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/**
 * TASK 10 - the distance between two points, in kilometres.
 *
 * Haversine. Earth is not a sphere, but at 25 km the error is metres and the
 * number is only ever used to sort a list and print "3.4 km away".
 */
export function distanceKm(a: Point, b: Point): number {
  // TODO(task 10):
  //   const R = 6371;                         // km, mean Earth radius
  //   dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  //   h = sin(dLat/2)^2 + cos(toRad(a.lat)) * cos(toRad(b.lat)) * sin(dLng/2)^2
  //   return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  //
  // Write `toRad` as a private helper in this file. Degrees in, always.
  throw ApiError.notImplemented();
}

/**
 * TASK 10 - the box `fanOutOffers` filters on before it measures anything.
 *
 * The order matters and it is the whole reason this function exists. The box is
 * a plain `where` on two columns, so Postgres can serve it from an index; the
 * haversine above then trims the corners off the square in JS, over the few
 * hundred rows that came back. Do it the other way round - measure first, filter
 * second - and every publish reads every technician in the country.
 *
 * A degree of latitude is ~111 km everywhere. A degree of longitude is 111 km at
 * the equator and shrinks with the cosine of the latitude, which is why the two
 * axes are not computed the same way.
 */
export function boundingBox(center: Point, radiusKm: number): BoundingBox {
  // TODO(task 10):
  //   const KM_PER_DEGREE_LAT = 111.32;       // name it, do not inline it
  //   latDelta = radiusKm / KM_PER_DEGREE_LAT
  //   lngDelta = radiusKm / (KM_PER_DEGREE_LAT * Math.cos(toRad(center.lat)))
  //   return { minLat, maxLat, minLng, maxLng }
  //
  // Egypt is nowhere near a pole or the date line, so clamping latitude to
  // +/-90 and wrapping longitude past +/-180 are not cases you have to handle.
  // Say so in a comment rather than half-handling them.
  throw ApiError.notImplemented();
}
