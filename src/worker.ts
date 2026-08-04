import { WorkerEntrypoint, Container, getRandom } from "cloudflare:workers";

export class ForgeContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "30s";
  override onStart() { console.log("Forge container started"); }
  override onStop() { console.log("Forge container stopped"); }
  override onError(error: unknown) { console.error("Forge container error:", error); }
}

export default class extends WorkerEntrypoint {
  async fetch(request: Request) {
    const container = await getRandom(this.env.FORGE_CONTAINER, 1);
    return await container.fetch(request);
  }
}
