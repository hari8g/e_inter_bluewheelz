/**
 * Dead-letter queue.
 *
 * A message that cannot be processed goes here and the partition CONTINUES. One
 * malformed record blocking a partition forever is the classic Kafka outage, and it
 * is entirely avoidable.
 */
import type { Producer } from "kafkajs";
import { metrics } from "./metrics.js";

let producer: Producer | null = null;
let topic = "intellicar.telemetry.dlq.v1";

export function configureDlq(p: Producer, dlqTopic: string): void {
  producer = p;
  topic = dlqTopic;
}

export interface DlqContext {
  sourceTopic: string;
  sourcePartition: number;
  sourceOffset: string;
  reason: string;
  error: string;
}

export async function sendToDlq(
  key: Buffer | null,
  value: Buffer | null,
  ctx: DlqContext,
): Promise<void> {
  metrics.increment("ingest.dlq.sent", { reason: ctx.reason });
  if (!producer) {
    console.error("[dlq] producer not configured; dropping", ctx);
    return;
  }
  try {
    await producer.send({
      topic,
      messages: [
        {
          key,
          value: value ?? Buffer.from(""),
          headers: {
            reason: ctx.reason,
            error: ctx.error.slice(0, 2000),
            sourceTopic: ctx.sourceTopic,
            sourcePartition: String(ctx.sourcePartition),
            sourceOffset: ctx.sourceOffset,
            failedAt: new Date().toISOString(),
          },
        },
      ],
    });
  } catch (err) {
    // Never let a DLQ failure take down the consumer.
    console.error("[dlq] send failed", err);
    metrics.increment("ingest.dlq.send_failed");
  }
}
