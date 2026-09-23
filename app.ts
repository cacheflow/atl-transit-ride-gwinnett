import GtfsRealtimeBindings from "gtfs-realtime-bindings";

/** A decoded GTFS Realtime snapshot, with protobuf fields preserved. */
export type BusFeed = GtfsRealtimeBindings.transit_realtime.FeedMessage;

const BUS_VEHICLE_POSITIONS_URL =
  "https://realtimegwinnett.availtec.com/InfoPoint/gtfs-realtime.ashx?type=vehicleposition";

const BUS_UPDATES_URL =
  "https://realtimegwinnett.availtec.com/InfoPoint/gtfs-realtime.ashx?type=alert";


export default class BusService {
 
  async getPositions(): Promise<BusFeed> {
    return this.getGtfsData(BUS_VEHICLE_POSITIONS_URL);
  }
  
  async getUpdates(): Promise<BusFeed> {
    return this.getGtfsData(BUS_UPDATES_URL);
  }

  private async getGtfsData(url: string): Promise<BusFeed> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept:
          "application/protobuf, application/protocol-buffer, application/octet-stream",
      },
    });
    
    if (!response.ok) {
      throw new Error(`Cobblinc request failed (HTTP ${response.status})`);
    }

    
    const bytes = new Uint8Array(await response.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
    const error = GtfsRealtimeBindings.transit_realtime.FeedMessage.verify(feed);

    if (error) {
      throw new TypeError(`Invalid Cobb bus feed: ${error}`);
    }

    return feed;
  }
}