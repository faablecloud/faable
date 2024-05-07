import { PackageJson } from "type-fest";

export type NodeBuildType = "node" | "next";

export type NodeBuidContext = {
  type: NodeBuildType;
  pkg: PackageJson;
};
