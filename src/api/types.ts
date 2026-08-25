export type Group =
  | "Energy" | "Crypto" | "Base metals" | "Precious"
  | "Global agri" | "India agri" | "Freight" | "Proxies";

export interface Instrument {
  symbol: string;
  name: string;
  group: Group;
  unit: string;
  source: string;
  price: number;
  /** ISO date of the close this price came from. */
  date: string;
  /** How many days old the print is. 0 means today. */
  stale_days: number;
  /** Sessions of history available. 1 means no archive to compare against. */
  history: number;
  /** Observation frequency. Only daily series get volatility bands. */
  freq: "daily" | "weekly" | "monthly";
}

export interface Board {
  /** True while the repo is still serving placeholder prices. */
  seed: boolean;
  asof: string;
  instruments: Instrument[];
}

export interface Series {
  dates: string[];
  close: number[];
}

export type SeriesMap = Record<string, Series>;

/** Per-tonne conversion so different contracts can share a cost stack. */
export interface Conversion {
  /** Multiply the quoted price by this to reach one tonne. */
  factor: number;
  currency: "USD" | "INR";
}

export type RuleKind = "threshold" | "move" | "freightShare";

export interface ThresholdRule {
  id: string;
  kind: "threshold";
  symbol: string;
  direction: "above" | "below";
  value: number;
}

export interface MoveRule {
  id: string;
  kind: "move";
  symbol: string;
  /** Absolute percentage move that counts as notable. */
  percent: number;
  sessions: number;
}

export interface FreightShareRule {
  id: string;
  kind: "freightShare";
  symbol: string;
  /** Fires when freight exceeds this share of landed cost. */
  percent: number;
}

export type Rule = ThresholdRule | MoveRule | FreightShareRule;

export interface Highlight {
  id: string;
  symbol: string;
  headline: string;
  detail: string;
  tone: "up" | "down" | "warn" | "info";
  /** Rule-driven highlights outrank the automatic ones. */
  pinned: boolean;
}

export interface BasketLeg {
  symbol: string;
  weight: number;
}

export interface Basket {
  id: string;
  name: string;
  legs: BasketLeg[];
}
