import assert from 'node:assert/strict';
import { beforeEach, afterEach, mock, test } from 'node:test';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
let requests;
let respond;

// Every test blocks real HTTP, including module import and construction.
beforeEach(() => {
  requests = [];
  respond = () => { throw new Error('Unexpected fetch'); };
  mock.method(globalThis, 'fetch', async (...args) => {
    requests.push(args);
    return respond(...args);
  });
});
afterEach(() => mock.restoreAll());

async function client() {
  const { default: BusService } = await import('../app.ts');
  return new BusService();
}

function protobuf(entity = []) {
  return FeedMessage.encode(FeedMessage.create({
    header: { gtfsRealtimeVersion: '2.0', incrementality: 0, timestamp: 1720000000 },
    entity,
  })).finish();
}

function reply(entity = []) {
  return new Response(protobuf(entity), {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

test('import and construction do not fetch', async () => {
  await client();
  assert.equal(requests.length, 0);
});

test('positions decode vehicle coordinates, route, timestamp, and feed header', async () => {
  respond = () => reply([{
    id: 'vehicle-1',
    vehicle: {
      trip: { tripId: 'trip-1', routeId: '10' },
      vehicle: { id: 'bus-1' },
      position: { latitude: 33.95, longitude: -84.05 },
      timestamp: 1720000000,
    },
  }]);
  const feed = await (await client()).getPositions();
  assert.equal(feed.header.gtfsRealtimeVersion, '2.0');
  assert.equal(Number(feed.header.timestamp), 1720000000);
  assert.equal(feed.entity.length, 1);
  const vehicle = feed.entity[0].vehicle;
  assert.equal(vehicle.trip.routeId, '10');
  assert.equal(vehicle.vehicle.id, 'bus-1');
  assert.ok(Math.abs(vehicle.position.latitude - 33.95) < 0.0001);
  assert.ok(Math.abs(vehicle.position.longitude + 84.05) < 0.0001);
  assert.equal(Number(vehicle.timestamp), 1720000000);
});

test('getUpdates returns service alerts with translations and affected routes', async () => {
  respond = () => reply([{
    id: 'alert-1',
    alert: {
      headerText: { translation: [{ text: 'Detour', language: 'en' }] },
      descriptionText: { translation: [{ text: 'Use the next stop.', language: 'en' }] },
      informedEntity: [{ routeId: '10' }],
    },
  }]);
  const feed = await (await client()).getUpdates();
  const alert = feed.entity[0].alert;
  assert.equal(alert.headerText.translation[0].text, 'Detour');
  assert.equal(alert.descriptionText.translation[0].text, 'Use the next stop.');
  assert.equal(alert.informedEntity[0].routeId, '10');
});

for (const [method, type] of [['getPositions', 'vehicleposition'], ['getUpdates', 'alert']]) {
  test(`${method} requests the correct feed without credentials and accepts empty snapshots`, async () => {
    respond = () => reply();
    const feed = await (await client())[method]();
    assert.equal(feed.entity.length, 0);
    assert.equal(requests.length, 1);
    const [url, options] = requests[0];
    assert.equal(url, `https://realtimegwinnett.availtec.com/InfoPoint/gtfs-realtime.ashx?type=${type}`);
    const headers = new Headers(options.headers);
    assert.match(headers.get('accept'), /application\/protobuf/);
    assert.equal(headers.has('authorization'), false);
    assert.ok(options.signal instanceof AbortSignal);
  });

  test(`${method} uses a fresh 20-second timeout and fetches on every call`, async () => {
    const durations = [];
    mock.method(AbortSignal, 'timeout', (duration) => {
      durations.push(duration);
      return new AbortController().signal;
    });
    respond = () => reply();
    const service = await client();
    await service[method]();
    await service[method]();
    assert.deepEqual(durations, [20000, 20000]);
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0][1].signal, requests[1][1].signal);
  });

  for (const status of [401, 404, 500]) {
    test(`${method} rejects HTTP ${status} before decoding the body`, async () => {
      respond = () => ({
        ok: false,
        status,
        arrayBuffer() { assert.fail('HTTP error body must not be decoded'); },
      });
      await assert.rejects((await client())[method](), new RegExp(`HTTP ${status}`));
      assert.equal(requests.length, 1);
    });
  }

  test(`${method} propagates network failures without retrying`, async () => {
    const error = new TypeError('Network unavailable');
    respond = () => { throw error; };
    await assert.rejects((await client())[method](), (actual) => actual === error);
    assert.equal(requests.length, 1);
  });

  test(`${method} propagates request timeout cancellation`, async () => {
    const controller = new AbortController();
    const error = new DOMException('Timed out', 'TimeoutError');
    mock.method(AbortSignal, 'timeout', () => controller.signal);
    respond = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      controller.abort(error);
    });
    await assert.rejects((await client())[method](), (actual) => actual === error);
  });

  test(`${method} propagates response-body failures`, async () => {
    const error = new DOMException('Body timed out', 'TimeoutError');
    respond = () => ({ ok: true, arrayBuffer: async () => { throw error; } });
    await assert.rejects((await client())[method](), (actual) => actual === error);
  });

  test(`${method} rejects plain-text error bodies returned with HTTP 200`, async () => {
    respond = () => new Response('Response made to FAILED GTFS-Realtime request');
    await assert.rejects((await client())[method]());
  });

  test(`${method} rejects truncated protobuf`, async () => {
    respond = () => new Response(new Uint8Array([0x0a, 0xff]));
    await assert.rejects((await client())[method]());
  });

  test(`${method} rejects a decoded feed with an invalid header enum`, async () => {
    const bytes = FeedMessage.encode(FeedMessage.create({
      header: { gtfsRealtimeVersion: '2.0', incrementality: 99 },
    })).finish();
    respond = () => new Response(bytes);
    await assert.rejects((await client())[method](), (error) =>
      error instanceof TypeError && /incrementality/.test(error.message));
  });
}
