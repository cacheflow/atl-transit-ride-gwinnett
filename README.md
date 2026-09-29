# Ride Gwinnett TypeScript client

![Ride Gwinnett logo](assets/transit-logo.png)

> **Unofficial community project.** This repository is not affiliated with,
> endorsed by, sponsored by, or maintained by Ride Gwinnett or Gwinnett County Government.
> For official transit information, visit [Ride Gwinnett](https://www.gwinnettcounty.com/government/departments/transportation/gwinnett-county-transit).

A small Node.js client for Ride Gwinnett bus vehicle positions and service alerts from
GTFS Realtime feeds.

Returns decoded feed snapshots with the original GTFS Realtime fields preserved.
No API key is required.

## Installation

Once published to npm, install the package in your project:

```sh
npm install ride-gwinnett
```

The intended package import is:

```ts
import BusService from 'ride-gwinnett';
import type { BusFeed } from 'ride-gwinnett';
```

**Publishing prerequisite:** the current checkout points `main` at a missing
`index.js` and does not generate TypeScript declarations. A release must include
a working JavaScript entry point and declaration files before the package imports
above can be used. Until then, use the source checkout as described below.

## Running from source

Use **Node.js 24+** to run the TypeScript source directly. From this directory:

```sh
npm ci
```

Create `example.ts` alongside `app.ts`:

```ts
import BusService from './app.ts';
import type { BusFeed } from './app.ts';

const buses = new BusService();

const positions: BusFeed = await buses.getPositions();
for (const entity of positions.entity) {
  if (!entity.vehicle) continue;

  console.log({
    vehicleId: entity.vehicle.vehicle?.id,
    routeId: entity.vehicle.trip?.routeId,
    position: entity.vehicle.position,
  });
}

// getUpdates() currently requests the service-alert feed.
const alerts = await buses.getUpdates();
for (const entity of alerts.entity) {
  if (!entity.alert) continue;

  console.log({
    header: entity.alert.headerText?.translation,
    description: entity.alert.descriptionText?.translation,
    affectedEntities: entity.alert.informedEntity,
  });
}
```

Run it with:

```sh
node example.ts
```

Importing the module and constructing a client perform no requests. Running
`node app.ts` on its own produces no output; call a client method to fetch data.

## API

`BusService` is the default export. `BusFeed` is a TypeScript type alias for the
`FeedMessage` decoded by `gtfs-realtime-bindings`.

| Method | Returns | Request timeout |
| --- | --- | --- |
| `getPositions()` | `Promise<BusFeed>` containing vehicle positions | 20 seconds |
| `getUpdates()` | `Promise<BusFeed>` containing service alerts | 20 seconds |

**Naming note:** `getUpdates()` currently uses `type=alert`, so its entities
contain `alert` records, not `tripUpdate` records.

Each call fetches a fresh snapshot, decodes the protobuf response, and verifies
the decoded message. The complete feed is returned, including its header and
entities. The client does not filter cancellations or normalize provider data.

Fields such as vehicle descriptors, positions, and stop-time updates may be
absent. Check optional fields before using them. Protobuf 64-bit values can be
`Long` objects rather than JavaScript numbers.

## Feed endpoints

- [Vehicle positions](https://realtimegwinnett.availtec.com/InfoPoint/gtfs-realtime.ashx?type=vehicleposition)
- [Service alerts](https://realtimegwinnett.availtec.com/InfoPoint/gtfs-realtime.ashx?type=alert)

## Errors and limitations

Requests reject on non-2xx HTTP responses, network failures, timeouts, protobuf
decoding failures, or decoded-message validation failures. There are no automatic
retries or caches.

An HTTP 200 response does not guarantee a valid feed. The provider can return a
plain-text error with a successful status; the current client attempts to decode
that body as protobuf, which can result in an `invalid wire type` error.

The current API covers vehicle positions and service alerts. It does not include
trip updates, static schedules, historical data, or normalized arrival records.

## Development status

This package currently supports direct source usage. Its `package.json` declares
the name `ride-gwinnett`, but the `main` entry points to `index.js`, which is not
present. There is no build script or configured TypeScript declaration output;
package-root imports are not ready for use.

The current error messages still refer to CobbLinc/Cobb because the implementation
was adapted from that client.

Run the mocked test suite with:

```sh
npm test
```

Tests use Node's built-in test runner and block real HTTP requests. Coverage includes
vehicle and alert decoding, feed URLs, empty snapshots, fresh request timeouts,
HTTP and network errors, body-read failures, malformed protobuf, and decoded-feed
validation. No API key or network connection is required.

## License

ISC, as declared in `package.json`.

The Ride Gwinnett name and logo belong to their respective owners and are used only
to identify the transit service. Their inclusion does not imply endorsement.
The logo is sourced from the [Ride Gwinnett bus tracker](https://realtimegwinnett.availtec.com/InfoPoint/Content/images/logo_web.png)
and is not covered by this project's software license.
