/**
 * Produces realistic sample messages to the raw topic for end-to-end testing.
 *
 *   KAFKA_BOOTSTRAP=localhost:9092 KAFKA_SSL=false npm run produce:sample
 *
 * Includes the -80 temperature sentinel deliberately, so you can verify the
 * normalizer strips it before it reaches any aggregate.
 */
import { Kafka } from "kafkajs";
import { loadIngestConfig } from "../src/ingest/config.js";

const config = loadIngestConfig();
const kafka = new Kafka({
  clientId: "e-inter-sample-producer",
  brokers: config.brokers,
  ssl: config.ssl,
  sasl: config.sasl,
});

const now = Date.now();

function tataCan(vehicleno: string) {
  const cells: Record<string, number> = {};
  for (let i = 1; i <= 29; i++) {
    cells[`cell_voltage_${String(i).padStart(2, "0")}`] = 3.6 + (i === 7 ? 0.048 : 0);
  }
  return {
    vehicleno,
    type: "can",
    data: {
      time: now,
      soc: 67, dte: 74, odometer: 12_400, vehicle_speed: 34, gear_state: 3,
      acceleration_pedal_position: 22, brake_pedal: 0,
      charging_status: 0, ttc: 0,
      no_of_cells: 29,
      no_of_temperature_sensors: 4,
      ...cells,
      cell_temperature_01: 34.5, cell_temperature_02: 35.0,
      cell_temperature_03: 34.8, cell_temperature_04: 35.2,
      cell_temperature_05: -80, cell_temperature_06: -80, // absent sensors
      max_cell_voltage: 3.648, min_cell_voltage: 3.6,
      harsh_braking: 2, harsh_braking_peak: 4.1, harsh_braking_mean: 3.2, harsh_braking_interval: 620,
      harsh_acceleration: 1, harsh_acceleration_peak: 3.4, harsh_acceleration_mean: 2.8, harsh_acceleration_interval: 900,
    },
  };
}

const messages = [
  { vehicleno: "KA01EV1001", type: "gps", data: { time: now - 3000, lat: 12.9716, lng: 77.5946, speed: 34, ignstatus: 1, alti: 920 } },
  tataCan("KA01EV1001"),
  { vehicleno: "KA01EV1003", type: "can", data: { time: now, soc: 62, dte: 58, odometer: 8_420, vehicle_speed: 28, charging_status: 0, acceleration: 18, brake_pedal: 0, eco_mode: 1, power_mode: 0, indicators: 2, gear_state: 3 } },
  { vehicleno: "KA01EV1004", type: "can", data: { time: now, soc: 58, dte: 96, odometer: 41_822, vehicle_speed: 22, charging_status: 0, gear: 3, acceleration_pedal: 15, brake_pedal: 0, handbrake: 0, trip_a: 142.6 } },
  { vehicleno: "KA01EV1005", type: "can", data: { time: now, soc: 71, dte: 210, odometer: 96_530, trip: 312.4, vehicle_speed: 46, brake_pedal: 0, current: 82.3, battery_voltage: 540.5, hv_volt_01: 540.1, acceleration_pedal: 31, road_speed_limit_status: 1 } },
  // Deliberately unknown — must be quarantined, never auto-created.
  { vehicleno: "KA99XX0000", type: "can", data: { time: now, soc: 50 } },
];

async function main() {
  const producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();

  await producer.send({
    topic: config.topicRaw,
    messages: [
      // Batch envelope, keyed by vehicleno so each vehicle keeps per-partition ordering.
      { key: "KA01EV1001", value: JSON.stringify({ bulkData: messages.slice(0, 2) }) },
      { key: "KA01EV1003", value: JSON.stringify({ bulkData: [messages[2]] }) },
      { key: "KA01EV1004", value: JSON.stringify({ bulkData: [messages[3]] }) },
      { key: "KA01EV1005", value: JSON.stringify({ bulkData: [messages[4]] }) },
      // Realtime envelope: a bare record with no bulkData wrapper.
      { key: "KA99XX0000", value: JSON.stringify(messages[5]) },
      // Malformed: must land in the DLQ without blocking the partition.
      { key: "BAD", value: "{ not json" },
    ],
  });

  console.log(`Produced 6 messages to ${config.topicRaw}`);
  console.log("Expect: 4 vehicles normalized, 1 quarantined (KA99XX0000), 1 in the DLQ (BAD).");
  await producer.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
