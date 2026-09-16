/** Ingest configuration, read once at boot so a missing var fails fast. */
import type { SASLOptions } from "kafkajs";

export interface IngestConfig {
  brokers: string[];
  clientId: string;
  groupId: string;
  topicRaw: string;
  topicDlq: string;
  ssl: boolean;
  sasl?: SASLOptions;
  sessionTimeoutMs: number;
  heartbeatIntervalMs: number;
  partitionsConcurrently: number;
  fromBeginning: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the ingest worker`);
  return v;
}

export function loadIngestConfig(): IngestConfig {
  const mechanism = (process.env.KAFKA_SASL_MECHANISM ?? "").toLowerCase();
  let sasl: SASLOptions | undefined;
  if (mechanism) {
    const username = required("KAFKA_USERNAME");
    const password = required("KAFKA_PASSWORD");
    if (mechanism === "plain") sasl = { mechanism: "plain", username, password };
    else if (mechanism === "scram-sha-256") sasl = { mechanism: "scram-sha-256", username, password };
    else if (mechanism === "scram-sha-512") sasl = { mechanism: "scram-sha-512", username, password };
    else throw new Error(`Unsupported KAFKA_SASL_MECHANISM "${mechanism}"`);
  }

  return {
    brokers: required("KAFKA_BOOTSTRAP").split(",").map((b) => b.trim()).filter(Boolean),
    clientId: process.env.KAFKA_CLIENT_ID ?? "e-inter-normalizer",
    groupId: process.env.KAFKA_CONSUMER_GROUP ?? "e-inter-normalizer-v1",
    topicRaw: process.env.KAFKA_TOPIC_RAW ?? "intellicar.telemetry.raw.v1",
    topicDlq: process.env.KAFKA_TOPIC_DLQ ?? "intellicar.telemetry.dlq.v1",
    ssl: process.env.KAFKA_SSL !== "false",
    sessionTimeoutMs: Number(process.env.KAFKA_SESSION_TIMEOUT_MS ?? 30_000),
    heartbeatIntervalMs: Number(process.env.KAFKA_HEARTBEAT_INTERVAL_MS ?? 3_000),
    partitionsConcurrently: Number(process.env.KAFKA_PARTITIONS_CONCURRENT ?? 3),
    fromBeginning: process.env.KAFKA_FROM_BEGINNING === "true",
  };
}
