import { closePool } from "../db/client.js";
import { runRollupWindow } from "./rollup.js";

runRollupWindow(7)
  .then((r) => {
    console.log(`[rollup] ${r.vehicles} vehicles / ${r.days} day-buckets`);
    return closePool();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
