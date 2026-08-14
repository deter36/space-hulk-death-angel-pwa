import type { Metadata } from "next";
import GameClient from "./game-client";

export const metadata: Metadata = {
  title: "Space Hulk: Death Angel",
  description: "A mobile command interface for the cooperative card game.",
};

export default function Home() {
  return <GameClient />;
}
