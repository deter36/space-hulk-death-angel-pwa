import { describe, expect, it } from "vitest";
import data from "./generated/base-game.json";

describe("generated base-game database", () => {
  it("matches physical component quantities", () => {
    expect(data.definitions.actions).toHaveLength(18);
    expect(data.definitions.marines).toHaveLength(12);
    expect(data.instances.events).toHaveLength(30);
    expect(data.definitions.terrain).toHaveLength(8);
    expect(data.definitions.locations).toHaveLength(18);
    expect(data.definitions.setupLocations).toHaveLength(4);
    expect(data.instances.terrain).toHaveLength(8);
    expect(data.instances.locations).toHaveLength(18);
    expect(data.instances.setupLocations).toHaveLength(4);
    expect(data.instances.genestealers).toHaveLength(36);
    expect(data.instances.broodLords).toHaveLength(2);
  });

  it("maps every player count to one physical Setup Location", () => {
    expect(data.setup.playerSetups.map((setup) => setup.setupLocationId)).toEqual([
      "setup-location.void-lock-1-player",
      "setup-location.void-lock-2-or-4-players",
      "setup-location.void-lock-3-or-6-players",
      "setup-location.void-lock-2-or-4-players",
      "setup-location.void-lock-5-players",
      "setup-location.void-lock-3-or-6-players",
    ]);
  });

  it("retains source rows and effect-handler coverage", () => {
    const effectDefs = [
      ...data.definitions.actions,
      ...data.definitions.events,
      ...data.definitions.terrain,
      ...data.definitions.locations,
    ];
    expect(effectDefs.every((item) => item.handlerId && item.source.row > 1)).toBe(true);
  });

  it("has four valid Terrain placements for every mission Location", () => {
    for (const location of data.definitions.locations) {
      const placements = data.definitions.locationTerrain.filter((item) => item.locationId === location.id);
      expect(placements).toHaveLength(4);
      expect(placements.every((item) => item.terrainId)).toBe(true);
      expect(new Set(placements.map((item) => item.terrainId)).size).toBe(4);
    }
  });

  it("keeps mechanically different same-title Event cards as distinct definitions", () => {
    const outOfThinAir = data.definitions.events.filter((event) => event.name === "Out of Thin Air");
    const theSwarm = data.definitions.events.filter((event) => event.name === "The Swarm");
    expect(outOfThinAir.map((event) => [event.copyIndex, event.movementIcon])).toEqual([[1, "HEAD"], [2, "CLAW"]]);
    expect(theSwarm.map((event) => [event.copyIndex, event.movementIcon])).toEqual([[1, "TAIL"], [2, "TONGUE"]]);
    expect(new Set([...outOfThinAir, ...theSwarm].map((event) => event.id)).size).toBe(4);
  });

  it("locks the corrected Location tiers, Blips, and Terrain placements", () => {
    expect(data.definitions.locations.find((location) => location.id === "location.hibernation-cluster")).toMatchObject({ tier: "3", leftBlips: 0, rightBlips: 0 });
    expect(data.definitions.locations.find((location) => location.id === "location.munitorium")).toMatchObject({ tier: "1C", leftBlips: 6, rightBlips: 7 });
    expect(data.definitions.locations.find((location) => location.id === "location.cryo-control")).toMatchObject({ tier: "1B" });
    expect(data.definitions.locations.find((location) => location.id === "location.wrath-of-baal-chapel")).toMatchObject({ tier: "3" });
    expect(data.definitions.locations.find((location) => location.id === "location.wreckage-labyrinth")).toMatchObject({ tier: "1B" });
    expect(data.definitions.locations.find((location) => location.id === "location.core-cogitator")).toMatchObject({ tier: "1C" });

    const placement = (locationId: string, side: "LEFT" | "RIGHT", markerOrder: number) =>
      data.definitions.locationTerrain.find((item) => item.locationId === locationId && item.side === side && item.markerOrder === markerOrder)?.terrainId;
    expect(placement("location.service-shaft", "LEFT", 2)).toBe("terrain.ventilation-duct");
    expect(placement("location.core-cogitator", "LEFT", 2)).toBe("terrain.ventilation-duct");
    expect(placement("location.teleportarium", "LEFT", 2)).toBe("terrain.dark-corner");
  });
});
