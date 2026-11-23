export type Phase = 'WAITING' | 'AT_ORIGIN' | 'IN_TRANSIT' | 'AT_DESTINATION' | 'RETURNING';
export type Point = { lat: number; lng: number };
export type Route = {
  origin_lat: number; origin_lng: number; origin_radius: number;
  dest_lat: number; dest_lng: number; dest_radius: number; plate: string; target: number;
};
export type Receipt = { departed: string; arrived: string; plate: string; origin: Point; destination: Point };
export type Trip = Route & { phase: Phase; revision: number; receipts: Receipt[]; departed?: string; origin?: Point };

export function distance(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h = Math.sin((a.lat - b.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((a.lng - b.lng) * rad / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function distances(route: Route, point: Point) {
  return [distance(point, {lat: route.origin_lat, lng: route.origin_lng}),
    distance(point, {lat: route.dest_lat, lng: route.dest_lng})];
}

export function nextPhase(trip: Trip, point: Point): Phase {
  const [origin, dest] = distances(trip, point);
  switch (trip.phase) {
    case 'WAITING': case 'RETURNING': return origin <= trip.origin_radius ? 'AT_ORIGIN' : trip.phase;
    case 'AT_ORIGIN': return origin > trip.origin_radius ? 'IN_TRANSIT' : trip.phase;
    case 'IN_TRANSIT': return dest <= trip.dest_radius ? 'AT_DESTINATION' : trip.phase;
    case 'AT_DESTINATION': return dest > trip.dest_radius ? 'RETURNING' : trip.phase;
  }
}
