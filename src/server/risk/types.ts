export interface RiskCheckContext {
  emergencyLocked: boolean;
  requireStopLoss: boolean;
  minRewardToRiskRatio: number;
  maxRiskPerTradeUsd: number;
  maxRiskPerTradePct: number;
  maxDailyLossUsd: number;
  maxWeeklyLossUsd: number;
  maxOpenPositions: number;
  maxExposurePerSymbolUsd: number;
  maxGrossExposureUsd: number;
  maxPositionSizeUsd: number;
  maxOrderNotionalUsd: number;
  maxConsecutiveLosses: number;
  maxSpreadPct: number;
  maxStaleQuoteSeconds: number;
  cooldownAfterStopMinutes: number;
  restrictedHoursOnly: boolean;

  accountEquity: number;
  buyingPower: number;
  isNewSymbolForAccount: boolean;
  currentOpenPositionsCount: number;
  existingPositionQuantity: number;
  grossExposureExcludingSymbolNotional: number;
  existingSymbolExposureNotional: number;
  todaysRealizedPlusUnrealizedPnl: number;
  weekRealizedPlusUnrealizedPnl: number;
  consecutiveLosingTrades: number;
  recentStopCooldownActiveForSymbol: boolean;

  quote: { bid: number; ask: number; last: number; isMarketOpen: boolean; isStale: boolean };
}

export interface OrderRiskInput {
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  isExtendedHours: boolean;
}

export interface RiskDecision {
  allowed: boolean;
  ruleKey: string;
  message: string;
  warnings: string[];
  estimatedEntryPrice: number;
  estimatedNotional: number;
}
