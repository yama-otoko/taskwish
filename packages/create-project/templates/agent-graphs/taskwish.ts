import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Builder } from "./src/builder";
import { FallbackGraph } from "./src/fallback-graph";
import { HierarchicalGraph } from "./src/hierarchical-graph";
import { MapReduceGraph } from "./src/map-reduce-graph";
import { ParallelGraph } from "./src/parallel-graph";
import { RoutingGraph } from "./src/routing-graph";
import { SequentialGraph } from "./src/sequential-graph";

await Server("TaskWish Agent Graphs", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [
    Builder,
    SequentialGraph,
    RoutingGraph,
    ParallelGraph,
    MapReduceGraph,
    HierarchicalGraph,
    FallbackGraph,
  ],
});
