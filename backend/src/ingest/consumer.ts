/**
 * Kafka consumer for the Intellicar telemetry topic.
 *
 * FOUR RULES, all load-bearing:
 *
 *  1. autoCommit is FALSE. Auto-commit acknowledges messages that may not have been
 *     persisted; a crash between commit and write is silent, permanent loss — the
 *     exact failure Kafka was chosen to prevent.
 *  2. Offsets are resolved and committed ONLY after the database transaction commits.
 *     At-least-once delivery + idempotent upsert = effectively-once processing.
 *  3. A poison message goes to the DLQ and the loop continues. It never blocks the
 *     partition.
 *  4. heartbeat() inside the message loop, or the broker evicts us mid-batch and the
 *     whole batch is reprocessed by another member.
 */
import { Kafka, type Consumer, type EachBatchPayload, type Producer, logLevel } from "kafkajs";
import { parseEnvelope, type IntellicarRecord } from "./envelope.js";
import { normalizeCan, normalizeGps, type NormalizedCanFrame, type NormalizedGpsFrame } from "./normalizer.js";
import { resolveVehicle } from "./vehicleResolver.js";
import { getProfile, getProfileForPlatform } from "../signals/profileRegistry.js";
import { persistBatch, previousState, quarantine } from "../db/repositories/telemetryRepo.js";
import { configureDlq, sendToDlq } from "./dlq.js";
import { metrics } from "./metrics.js";
import { loadIngestConfig, type IngestConfig } from "./config.js";

export interface ConsumerHandle {
  consumer: Consumer;
  producer: Producer;
  stop: () => Promise<void>;
}

export async function startConsumer(config: IngestConfig = loadIngestConfig()): Promise<ConsumerHandle> {
  const kafka = new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    ssl: config.ssl,
    sasl: config.sasl,
    logLevel: logLevel.INFO,
    retry: { initialRetryTime: 300, retries: 10, maxRetryTime: 30_000, factor: 2 },
  });

  const producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();
  configureDlq(producer, config.topicDlq);

  // NOTE: KafkaJS 2.x does not support static group membership (groupInstanceId),
  // so every restart triggers a group rebalance. That is tolerable at pilot scale
  // (rebalance takes seconds and the idempotent upsert absorbs any reprocessing),
  // but it is the main reason to consider confluent-kafka-javascript if you later
  // run many consumer instances.
  const consumer = kafka.consumer({
    groupId: config.groupId,
    sessionTimeout: config.sessionTimeoutMs,
    heartbeatInterval: config.heartbeatIntervalMs,
  });
  await consumer.connect();
  await consumer.subscribe({ topic: config.topicRaw, fromBeginning: config.fromBeginning });

  await consumer.run({
    autoCommit: false, // rule 1
    eachBatchAutoResolve: false,
    partitionsConsumedConcurrently: config.partitionsConcurrently,
    eachBatch: (payload) => handleBatch(payload, config),
  });

  console.log(
    `[ingest] consuming ${config.topicRaw} as group ${config.groupId} from ${config.brokers.join(",")}`,
  );

  return {
    consumer,
    producer,
    stop: async () => {
      await consumer.disconnect();
      await producer.disconnect();
    },
  };
}

export async function handleBatch(
  { batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }: EachBatchPayload,
  config: IngestConfig,
): Promise<void> {
  const started = Date.now();
  const canFrames: NormalizedCanFrame[] = [];
  const gpsFrames: NormalizedGpsFrame[] = [];
  const offsets: string[] = [];
  const receivedAt = new Date();

  for (const message of batch.messages) {
    if (!isRunning() || isStale()) break; // shutting down, or the partition was reassigned

    const ctxBase = {
      sourceTopic: batch.topic,
      sourcePartition: batch.partition,
      sourceOffset: message.offset,
    };

    try {
      const parsed = parseEnvelope(message.value ?? Buffer.from(""));
      if (!parsed.ok) {
        await sendToDlq(message.key, message.value, {
          ...ctxBase,
          reason: "parse_error",
          error: parsed.error ?? "unknown",
        });
        metrics.increment("ingest.rejected", { reason: "parse_error" });
        offsets.push(message.offset); // rule 3: never block the partition
        continue;
      }

      for (const record of parsed.records) {
        const frames = await normalizeRecord(record, receivedAt, ctxBase, message);
        if (frames?.kind === "can") canFrames.push(frames);
        else if (frames?.kind === "gps") gpsFrames.push(frames);
      }

      offsets.push(message.offset);
    } catch (err) {
      await sendToDlq(message.key, message.value, {
        ...ctxBase,
        reason: "handler_error",
        error: (err as Error).message,
      });
      metrics.increment("ingest.rejected", { reason: "handler_error" });
      offsets.push(message.offset);
    }

    await heartbeat(); // rule 4
  }

  // One transaction for the whole batch.
  await persistBatch({ canFrames, gpsFrames });

  // Rule 2: resolve and commit only now that the write is durable.
  for (const offset of offsets) resolveOffset(offset);
  await commitOffsetsIfNecessary();

  metrics.increment("ingest.records", { type: "can" }, canFrames.length);
  metrics.increment("ingest.records", { type: "gps" }, gpsFrames.length);
  metrics.observe("ingest.batch.duration_ms", Date.now() - started);
  metrics.gauge(
    "kafka.consumer.lag",
    Number(batch.highWatermark) - Number(batch.lastOffset()) - 1,
    { partition: batch.partition },
  );
  metrics.gauge("kafka.last_batch_at", Date.now());
  void config;
}

async function normalizeRecord(
  record: IntellicarRecord,
  receivedAt: Date,
  ctx: { sourceTopic: string; sourcePartition: number; sourceOffset: string },
  message: { key: Buffer | null; value: Buffer | null },
): Promise<NormalizedCanFrame | NormalizedGpsFrame | null> {
  const vehicle = await resolveVehicle(record.vehicleno);

  if (!vehicle) {
    // Quarantine, never auto-create.
    metrics.increment("ingest.unknown_vehicle", { vehicleno: record.vehicleno });
    await quarantine(record.vehicleno, "unknown_vehicleno", record).catch(() => undefined);
    await sendToDlq(message.key, message.value, {
      ...ctx,
      reason: "unknown_vehicleno",
      error: `No vehicle registered for vehicleno "${record.vehicleno}"`,
    });
    return null;
  }

  if (record.type === "gps") {
    return normalizeGps(record, vehicle.id, receivedAt);
  }

  const profile = getProfile(vehicle.signal_profile_id) ?? getProfileForPlatform(vehicle.oem_platform);
  const capturedAtGuess = new Date(record.data.time);
  const previous = await previousState(vehicle.id, capturedAtGuess);
  const frame = normalizeCan(record, vehicle.id, profile, previous, receivedAt);

  for (const r of frame.rejects) {
    metrics.increment("ingest.signal_rejected", { signal: r.signal, reason: r.reason });
  }
  return frame;
}
