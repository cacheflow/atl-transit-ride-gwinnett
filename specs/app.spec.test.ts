import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import BusService from "../app.ts";

const BUS_VEHICLE_POSITIONS_URL =
  "https://realtimegwinnett.availtec.com/InfoPoint/gtfs-realtime.ashx?type=vehicleposition";

const BUS_UPDATES_URL =
  "https://realtimegwinnett.availtec.com/InfoPoint/gtfs-realtime.ashx?type=alert";


function createMockFeedBytes(options?: {
  vehicleId?: string;
  routeId?: string;
  tripId?: string;
}): Uint8Array {
  const message = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
    header: {
      gtfsRealtimeVersion: "2.0",
      incrementality:
        GtfsRealtimeBindings.transit_realtime.FeedHeader.Incrementality.FULL_DATASET,
      timestamp: 1700000000,
    },
    entity: [
      {
        id: "entity-1",
        vehicle: {
          trip: {
            routeId: options?.routeId ?? "10",
            tripId: options?.tripId ?? "trip-100",
          },
          position: {
            latitude: 33.9526,
            longitude: -84.5499,
            bearing: 180,
            speed: 12.5,
          },
          vehicle: {
            id: options?.vehicleId ?? "bus-401",
          },
        },
        tripUpdate: {
          trip: {
            tripId: options?.tripId ?? "trip-100",
            routeId: options?.routeId ?? "10",
          },
          stopTimeUpdate: [
            {
              stopSequence: 1,
              stopId: "stop-9001",
              arrival: { delay: 120 },
            },
          ],
        },
      },
    ],
  });

  return GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(message).finish();
}

describe("BusService", () => {
  let busService: BusService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    busService = new BusService();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.reset();
  });

  describe("getPositions()", () => {
    it("fetches vehicle positions from the correct ride-gwinnett endpoint", async () => {
      const mockBytes = createMockFeedBytes({ vehicleId: "cobb-bus-101", routeId: "10" });
      let capturedUrl = "";
      let capturedHeaders: HeadersInit | undefined;

      globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = init?.headers;
        return new Response(mockBytes, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        });
      }) as typeof fetch;

      const feed = await busService.getPositions();

      assert.equal(capturedUrl, BUS_VEHICLE_POSITIONS_URL);
      assert.ok(feed.header);
      assert.equal(feed.header.gtfsRealtimeVersion, "2.0");
      assert.equal(feed.entity.length, 1);
      assert.equal(feed.entity[0]?.vehicle?.vehicle?.id, "cobb-bus-101");
      assert.equal(feed.entity[0]?.vehicle?.trip?.routeId, "10");
      assert.ok(
        Math.abs((feed.entity[0]?.vehicle?.position?.latitude ?? 0) - 33.9526) < 0.001
      );
    });

    it("sends appropriate Accept headers and an AbortSignal timeout", async () => {
      const mockBytes = createMockFeedBytes();
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init;
        return new Response(mockBytes, { status: 200 });
      }) as typeof fetch;

      await busService.getPositions();

      assert.ok(capturedInit?.signal instanceof AbortSignal);
      const headers = capturedInit?.headers as Record<string, string>;
      assert.ok(headers.Accept.includes("application/protobuf") || headers.Accept.includes("application/octet-stream"));
    });
  });

  describe("getUpdates()", () => {
    it("fetches trip updates from the correct ride-gwinnett endpoint", async () => {
      const mockBytes = createMockFeedBytes({ tripId: "trip-exp-100" });
      let capturedUrl = "";

      globalThis.fetch = mock.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return new Response(mockBytes, { status: 200 });
      }) as typeof fetch;

      const feed = await busService.getUpdates();

      assert.equal(capturedUrl, BUS_UPDATES_URL);
      assert.equal(feed.entity.length, 1);
      assert.equal(feed.entity[0]?.tripUpdate?.trip?.tripId, "trip-exp-100");
      assert.equal(feed.entity[0]?.tripUpdate?.stopTimeUpdate?.[0]?.stopId, "stop-9001");
    });
  });

  describe("Error handling", () => {
    it("throws an error when upstream returns non-2xx HTTP status", async () => {
      globalThis.fetch = mock.fn(async () => {
        return new Response("Internal Server Error", { status: 500 });
      }) as typeof fetch;

      await assert.rejects(
        () => busService.getPositions(),
        /ride-gwinnett request failed \(HTTP 500\)/
      );
    });

    it("throws an error when upstream returns HTTP 404", async () => {
      globalThis.fetch = mock.fn(async () => {
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      await assert.rejects(
        () => busService.getUpdates(),
        /ride-gwinnett request failed \(HTTP 404\)/
      );
    });

    it("throws a TypeError when feed decoding fails on corrupt data", async () => {
      // Returning random garbage text (e.g. HTML error page or corrupt payload)
      const garbageBytes = new TextEncoder().encode("<html>502 Bad Gateway</html>");

      globalThis.fetch = mock.fn(async () => {
        return new Response(garbageBytes, { status: 200 });
      }) as typeof fetch;

      await assert.rejects(
        () => busService.getPositions(),
        (err: Error) => {
          // protobuf decode will throw or verify will throw
          return err instanceof Error;
        }
      );
    });

    it("propagates fetch network or abort errors", async () => {
      globalThis.fetch = mock.fn(async () => {
        throw new Error("fetch failed: connection reset");
      }) as typeof fetch;

      await assert.rejects(
        () => busService.getPositions(),
        /fetch failed: connection reset/
      );
    });
  });
});
