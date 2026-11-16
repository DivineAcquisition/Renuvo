/**
 * Drive times (Routes API, with Selestial's server key) and optimized day plans (Route Optimization API,
 * with Selestial's service account). Both answer questions; neither changes a schedule. Dispatch shows
 * the result as a proposal that still passes every eligibility and availability rule.
 */
import { GoogleError, googleCall, type Fetch } from "./http";

export type Place = { lat: number; lng: number } | { address: string };

const waypoint = (place: Place) => ("address" in place ? { waypoint: { address: place.address } } : { waypoint: { location: { latLng: { latitude: place.lat, longitude: place.lng } } } });

export type Leg = { from: number; to: number; seconds: number | null; meters: number | null; ok: boolean };

/** Drive time for every origin to every destination. A pair Google cannot route is ok: false, never a guess. */
export async function matrix(apiKey: string, origins: Place[], destinations: Place[], departAt?: number, fetcher?: Fetch): Promise<Leg[]> {
  if (origins.length * destinations.length > 625) throw new GoogleError("invalid", "Too many places at once for one drive-time request.");
  const rows = await googleCall<{ originIndex?: number; destinationIndex?: number; duration?: string; distanceMeters?: number; condition?: string; status?: { code?: number } }[]>("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", null, {
    method: "POST",
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition,status" },
    body: { origins: origins.map(waypoint), destinations: destinations.map(waypoint), travelMode: "DRIVE", routingPreference: departAt ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE", ...(departAt && departAt > Date.now() ? { departureTime: new Date(departAt).toISOString() } : {}) },
    fetcher,
  });
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const ok = row.condition === "ROUTE_EXISTS" && !row.status?.code;
    return { from: row.originIndex ?? 0, to: row.destinationIndex ?? 0, seconds: ok && row.duration ? Number(row.duration.replace(/s$/, "")) : null, meters: ok ? (row.distanceMeters ?? null) : null, ok };
  });
}

export type Visit = { id: string; place: { lat: number; lng: number }; windowStart: number; windowEnd: number; durationSeconds: number; allowed: string[] };
/** Selestial does not know where a cleaner starts the day, so a route may begin at its first visit. */
export type Worker = { id: string; start?: { lat: number; lng: number }; shiftStart: number; shiftEnd: number };

export function optimizeRequest(visits: Visit[], workers: Worker[]) {
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    model: {
      globalStartTime: iso(Math.min(...visits.map((v) => v.windowStart), ...workers.map((w) => w.shiftStart))),
      globalEndTime: iso(Math.max(...visits.map((v) => v.windowEnd), ...workers.map((w) => w.shiftEnd))),
      shipments: visits.map((visit) => ({
        label: visit.id,
        deliveries: [{ arrivalLocation: { latitude: visit.place.lat, longitude: visit.place.lng }, duration: `${visit.durationSeconds}s`, timeWindows: [{ startTime: iso(visit.windowStart), endTime: iso(visit.windowEnd) }] }],
        // Only cleaners Selestial's own rules allow for this visit may take it.
        allowedVehicleIndices: visit.allowed.map((id) => workers.findIndex((w) => w.id === id)).filter((i) => i >= 0),
      })),
      vehicles: workers.map((worker) => ({ label: worker.id, ...(worker.start ? { startLocation: { latitude: worker.start.lat, longitude: worker.start.lng } } : {}), startTimeWindows: [{ startTime: iso(worker.shiftStart) }], endTimeWindows: [{ endTime: iso(worker.shiftEnd) }], travelMode: "DRIVING" })),
    },
    considerRoadTraffic: false,
  };
}

export type Proposal = { routes: { worker: string; visits: { id: string; start: string }[] }[]; skipped: string[] };

export async function optimize(accessToken: string, project: string, visits: Visit[], workers: Worker[], fetcher?: Fetch): Promise<Proposal> {
  if (!/^[a-z][a-z0-9-]{4,61}$/.test(project)) throw new GoogleError("invalid", "GOOGLE_CLOUD_PROJECT is not a project id.");
  const body = await googleCall<{ routes?: { vehicleLabel?: string; visits?: { shipmentLabel?: string; startTime?: string }[] }[]; skippedShipments?: { label?: string }[] }>(`https://routeoptimization.googleapis.com/v1/projects/${project}:optimizeTours`, accessToken, { method: "POST", body: optimizeRequest(visits, workers), fetcher, timeoutMs: 60_000 });
  return {
    routes: (body.routes ?? []).filter((r) => r.visits?.length).map((r) => ({ worker: r.vehicleLabel ?? "", visits: (r.visits ?? []).map((v) => ({ id: v.shipmentLabel ?? "", start: v.startTime ?? "" })) })),
    skipped: (body.skippedShipments ?? []).map((s) => s.label ?? ""),
  };
}
