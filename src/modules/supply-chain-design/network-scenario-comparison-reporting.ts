import type {
  NetworkScenarioComparisonRunDetail,
  NetworkScenarioComparisonRunListItem
} from "@/modules/supply-chain-design/network-scenario-comparison-persistence";

export type NetworkScenarioComparisonExportType =
  | "results"
  | "summary"
  | "facility-summary"
  | "delivery-assignments"
  | "alternative-audit";

type ComparisonRun = NetworkScenarioComparisonRunDetail | NetworkScenarioComparisonRunListItem;

type CsvTable = {
  filenameSuffix: string;
  rows: string[][];
};

export function exportNetworkScenarioComparisonCsv(run: ComparisonRun, exportType: NetworkScenarioComparisonExportType) {
  const table = buildNetworkScenarioComparisonCsvTable(run, exportType);
  return toCsv(table.rows);
}

export function networkScenarioComparisonExportFilename(run: Pick<ComparisonRun, "createdAt">, exportType: NetworkScenarioComparisonExportType) {
  const date = run.createdAt.toISOString().slice(0, 10);
  if (exportType === "alternative-audit") return `network-cost-audit-${date}.csv`;
  return `network-scenario-results-${date}.csv`;
}

export function buildNetworkScenarioComparisonCsvTable(run: ComparisonRun, exportType: NetworkScenarioComparisonExportType): CsvTable {
  if (!run.resultSummary) {
    throw new Error("Network Scenario Comparison result is not available.");
  }
  if (exportType === "results") return buildResultsCsv(run);
  if (exportType === "summary") return buildSummaryCsv(run);
  if (exportType === "facility-summary") return buildFacilitySummaryCsv(run);
  if (exportType === "delivery-assignments") return buildDeliveryAssignmentsCsv(run);
  if (exportType === "alternative-audit") return buildAlternativeAuditCsv(run);
  throw new Error("Network Scenario Comparison export type is not supported.");
}

export function summarizeNetworkScenarioComparisonCoverage(run: ComparisonRun) {
  const result = requiredResult(run);
  return [
    scenarioCoverage("A", run.scenarioAName, result.scenarioA),
    scenarioCoverage("B", run.scenarioBName, result.scenarioB)
  ];
}

export function buildNetworkScenarioComparisonCostRows(run: ComparisonRun) {
  const result = requiredResult(run);
  return [
    ["Transportation", csvNumber(result.scenarioA.modeledTransportationCost), csvNumber(result.scenarioB.modeledTransportationCost)],
    ["Warehouse", csvNumber(result.scenarioA.totalWarehouseCost), csvNumber(result.scenarioB.totalWarehouseCost)],
    ["Total Network Cost", csvNumber(result.scenarioA.totalNetworkCost), csvNumber(result.scenarioB.totalNetworkCost)]
  ];
}

export function networkScenarioComparisonSavingsCallout(run: ComparisonRun) {
  const result = requiredResult(run);
  return comparisonInterpretation(result, run.scenarioAName, run.scenarioBName);
}

export function compactNetworkScenarioComparisonCoverage(run: ComparisonRun) {
  const [scenarioA, scenarioB] = summarizeNetworkScenarioComparisonCoverage(run);
  if (
    scenarioA.status === "COMPLETE" &&
    scenarioB.status === "COMPLETE" &&
    scenarioA.representedShipments !== null &&
    scenarioA.assignedRepresentedShipments === scenarioA.representedShipments &&
    scenarioB.representedShipments === scenarioA.representedShipments &&
    scenarioB.assignedRepresentedShipments === scenarioB.representedShipments
  ) {
    return [`Coverage: ${scenarioA.assignedRepresentedShipments} of ${scenarioA.representedShipments} eligible shipments modeled in both scenarios.`];
  }
  return [coverageSentence(scenarioA), coverageSentence(scenarioB)];
}

function buildSummaryCsv(run: ComparisonRun): CsvTable {
  const result = requiredResult(run);
  const scenarioA = result.scenarioA;
  const scenarioB = result.scenarioB;
  return {
    filenameSuffix: "summary",
    rows: [
      [
        "Run ID",
        "Run status",
        "Scenario A",
        "Scenario B",
        "Completeness",
        "Scenario A modeled transportation",
        "Scenario B modeled transportation",
        "Scenario A warehouse cost",
        "Scenario B warehouse cost",
        "Scenario A total network cost",
        "Scenario B total network cost",
        "Difference convention",
        "Represented demand difference",
        "Percent difference",
        "Lower-cost scenario",
        "Currency",
        "FX applied",
        "CAD to USD rate",
        "Savings interpretation",
        "Scenario A coverage",
        "Scenario B coverage"
      ],
      [
        run.id,
        run.status,
        run.scenarioAName,
        run.scenarioBName,
        result.completenessStatus,
        csvNumber(scenarioA.modeledTransportationCost),
        csvNumber(scenarioB.modeledTransportationCost),
        csvNumber(scenarioA.totalWarehouseCost),
        csvNumber(scenarioB.totalWarehouseCost),
        csvNumber(scenarioA.totalNetworkCost),
        csvNumber(scenarioB.totalNetworkCost),
        String(result.comparison.differenceFormula ?? "Scenario B - Scenario A"),
        csvNumber(result.comparison.totalDifference),
        csvNumber(result.comparison.percentDifference),
        String(result.comparison.lowerCostScenario ?? "Not available"),
        String(scenarioB.normalizedCurrency ?? scenarioA.normalizedCurrency ?? scenarioA.currency ?? scenarioB.currency ?? ""),
        String(Boolean(scenarioA.fxApplied || scenarioB.fxApplied)),
        csvNumber(run.fxInput?.cadToUsdRate ?? scenarioA.cadToUsdRate ?? scenarioB.cadToUsdRate),
        comparisonInterpretation(result, run.scenarioAName, run.scenarioBName),
        coverageSentence(scenarioCoverage("A", run.scenarioAName, scenarioA)),
        coverageSentence(scenarioCoverage("B", run.scenarioBName, scenarioB))
      ]
    ]
  };
}

function buildResultsCsv(run: ComparisonRun): CsvTable {
  return {
    filenameSuffix: "results",
    rows: [
      ["Section", "Scenario", "Metric", "Value"],
      ...buildNetworkScenarioComparisonCostRows(run).flatMap((row) => [
        ["Scenario summary", run.scenarioAName, row[0], row[1]],
        ["Scenario summary", run.scenarioBName, row[0], row[2]]
      ]),
      [],
      ["Section", "Scenario", "Warehouse", "Type", "Delivery locations", "Shipments", "Pallets", "Transportation", "Variable warehouse cost", "Fixed warehouse cost", "Total contribution"],
      ...warehouseAllocationRows(run).map((row) => [
        "Warehouse summary",
        row[0],
        row[1],
        row[2],
        row[4],
        row[5],
        row[6],
        row[7],
        row[8],
        row[9],
        row[10]
      ]),
      [],
      ["Section", "Scenario", "Delivery location", "Assigned warehouse", "Carrier", "Selected rate", "Transportation cost", "Variable warehouse cost", "Total served cost", "Represented shipments", "Pallets"],
      ...winningDeliveryAssignmentRows(run).map((row) => [
        "Winning delivery assignment",
        row[0],
        row[1],
        row[2],
        row[3],
        row[4],
        row[5],
        row[6],
        row[7],
        row[8],
        row[9]
      ])
    ]
  };
}

function buildFacilitySummaryCsv(run: ComparisonRun): CsvTable {
  return {
    filenameSuffix: "facility-summary",
    rows: [
      [
        "Scenario",
        "Warehouse",
        "Type",
        "Location",
        "Delivery locations served",
        "Represented shipments",
        "Represented pallets",
        "Transportation",
        "Variable warehouse cost",
        "Fixed warehouse cost",
        "Total contribution"
      ],
      ...warehouseAllocationRows(run)
    ]
  };
}

function buildDeliveryAssignmentsCsv(run: ComparisonRun): CsvTable {
  return {
    filenameSuffix: "delivery-assignments",
    rows: [
      [
        "Delivery location",
        "Destination postal or region",
        "Country",
        "Shipment/source reference",
        "Represented shipments",
        "Represented pallets",
        "Scenario A assigned warehouse",
        "Scenario B assigned warehouse",
        "Scenario A transportation",
        "Scenario B transportation"
      ],
      ...deliveryAssignmentRows(run)
    ]
  };
}

function buildAlternativeAuditCsv(run: ComparisonRun): CsvTable {
  return {
    filenameSuffix: "alternative-audit",
    rows: [
      [
        "Scenario",
        "Destination/profile",
        "Warehouse",
        "Warehouse type",
        "Selected carrier",
        "Selected rate",
        "Status",
        "Winning",
        "Represented shipments",
        "Represented pallets",
        "Modeled transportation cost",
        "Warehouse assignment cost",
        "Combined assignment cost",
        "Missing reasons",
        "Rate source",
        "Lane ID",
        "Batch ID"
      ],
      ...alternativeRows(run)
    ]
  };
}

export function facilitySummaryRows(run: ComparisonRun) {
  return warehouseAllocationRows(run);
}

export function winningDeliveryAssignmentRows(run: ComparisonRun) {
  const result = requiredResult(run);
  return [
    ...scenarioWinningDeliveryRows(run.scenarioAName, result.scenarioA),
    ...scenarioWinningDeliveryRows(run.scenarioBName, result.scenarioB)
  ];
}

export function warehouseAllocationRows(run: ComparisonRun) {
  const result = requiredResult(run);
  return [
    ...scenarioFacilityRows("A", run.scenarioAName, result.scenarioA, run),
    ...scenarioFacilityRows("B", run.scenarioBName, result.scenarioB, run)
  ];
}

export function assignmentRows(run: ComparisonRun, winnersOnly: boolean) {
  const result = requiredResult(run);
  return [
    ...scenarioAssignmentRows("A", run.scenarioAName, result.scenarioA, winnersOnly),
    ...scenarioAssignmentRows("B", run.scenarioBName, result.scenarioB, winnersOnly)
  ];
}

export function alternativeRows(run: ComparisonRun) {
  const result = requiredResult(run);
  return [
    ...scenarioAlternativeRows(run.scenarioAName, result.scenarioA),
    ...scenarioAlternativeRows(run.scenarioBName, result.scenarioB)
  ];
}

export function deliveryAssignmentRows(run: ComparisonRun) {
  const result = requiredResult(run);
  const aWinners = winningAssignmentsByDelivery(result.scenarioA);
  const bWinners = winningAssignmentsByDelivery(result.scenarioB);
  const keys = Array.from(new Set([...aWinners.keys(), ...bWinners.keys()])).sort();
  return keys.map((key) => {
    const a = aWinners.get(key);
    const b = bWinners.get(key);
    const base = a ?? b;
    return [
      base?.deliveryLabel ?? key,
      base?.destination ?? "",
      base?.country ?? "",
      base?.sourceReference ?? "",
      csvNumber(base?.representedShipments),
      csvNumber(base?.representedPallets),
      a?.warehouse ?? "Unavailable",
      b?.warehouse ?? "Unavailable",
      csvNumber(a?.transportation),
      csvNumber(b?.transportation)
    ];
  });
}

export function hasCompetingAlternatives(run: ComparisonRun) {
  const result = requiredResult(run);
  return [...arrayValue(result.scenarioA.profileResults), ...arrayValue(result.scenarioB.profileResults)].some((item) => arrayValue(objectValue(item).alternatives).length > 1);
}

export function coverageSentence(coverage: ReturnType<typeof scenarioCoverage>) {
  if (coverage.representedShipments === null || coverage.assignedRepresentedShipments === null) {
    return `${coverage.scenarioName}: coverage unavailable`;
  }
  const percent = coverage.modeledRateCoverage === null ? "Unavailable" : `${(coverage.modeledRateCoverage * 100).toFixed(1)}% coverage`;
  return `${coverage.scenarioName}: ${coverage.assignedRepresentedShipments} of ${coverage.representedShipments} eligible shipments modeled - ${percent}`;
}

function scenarioCoverage(scenarioKey: "A" | "B", scenarioName: string, scenario: Record<string, unknown>) {
  const assigned = numberValue(scenario.assignedRepresentedShipments);
  const incomplete = numberValue(scenario.incompleteRepresentedShipments);
  const represented = assigned !== null || incomplete !== null ? (assigned ?? 0) + (incomplete ?? 0) : null;
  return {
    scenarioKey,
    scenarioName,
    status: String(scenario.status ?? "UNKNOWN"),
    representedShipments: represented,
    assignedRepresentedShipments: assigned,
    incompleteRepresentedShipments: incomplete,
    modeledRateCoverage: represented && represented > 0 && assigned !== null ? assigned / represented : null,
    activeWarehouseCount: Array.isArray(scenario.facilityTotals) ? scenario.facilityTotals.length : 0
  };
}

function scenarioFacilityRows(scenarioKey: "A" | "B", scenarioName: string, scenario: Record<string, unknown>, run: ComparisonRun) {
  const profileResults = arrayValue(scenario.profileResults);
  return arrayValue(scenario.facilityTotals).map((item) => {
    const facility = objectValue(item);
    const facilityId = textValue(facility.facilityId);
    const sourceType = textValue(facility.facilitySourceType);
    const location = formatFacilityLocation(run, scenarioKey, facilityId, sourceType);
    const winningProfiles = profileResults.filter((profileItem) => {
      const profile = objectValue(profileItem);
      return textValue(profile.winnerFacilityId) === facilityId;
    });
    const deliveryLocationCount = new Set(winningProfiles.map((profileItem) => deliveryKey(objectValue(profileItem)))).size;
    const representedPallets = sumNumbers(winningProfiles.map((profileItem) => {
      const profile = objectValue(profileItem);
      const winner = arrayValue(profile.alternatives).map(objectValue).find((alternative) => Boolean(alternative.winning));
      return numberValue(winner?.representedPallets) ?? numberValue(profile.representedPallets);
    }));
    return [
      scenarioName,
      `${facilityId} - ${textValue(facility.facilityName)}`,
      formatSourceType(sourceType),
      location,
      csvNumber(deliveryLocationCount),
      csvNumber(facility.representedShipments),
      csvNumber(representedPallets),
      csvNumber(facility.modeledTransportationCost),
      csvNumber(facility.variableWarehouseCost),
      csvNumber(facility.annualAllInWarehouseCost),
      csvNumber(facility.totalFacilityContribution)
    ];
  });
}

function scenarioWinningDeliveryRows(scenarioName: string, scenario: Record<string, unknown>) {
  return arrayValue(scenario.profileResults).flatMap((item) => {
    const profile = objectValue(item);
    const winner = arrayValue(profile.alternatives).map(objectValue).find((alternative) => Boolean(alternative.winning));
    if (!winner) return [];
    const transportationAlternative = objectValue(winner.transportationAlternative ?? {});
    const selectedQuote = objectValue(transportationAlternative.selectedQuote ?? {});
    const selectedRate = numberValue(selectedQuote.total) ?? numberValue(transportationAlternative.selectedRate) ?? numberValue(transportationAlternative.reusedSelectedRate);
    return [[
      scenarioName,
      deliveryLabel(profile),
      `${textValue(winner.facilityId)} - ${textValue(winner.facilityName)}`,
      textValue(selectedQuote.carrierName) || textValue(transportationAlternative.carrierName) || "Unavailable",
      csvNumber(selectedRate),
      csvNumber(winner.modeledTransportationCost),
      csvNumber(winner.variableWarehouseCost ?? 0),
      csvNumber(winner.combinedAssignmentCost),
      csvNumber(winner.representedShipments ?? profile.representedShipments),
      csvNumber(winner.representedPallets ?? profile.representedPallets)
    ]];
  });
}

function scenarioAssignmentRows(scenarioKey: "A" | "B", scenarioName: string, scenario: Record<string, unknown>, winnersOnly: boolean) {
  return arrayValue(scenario.profileResults).flatMap((item) => {
    const profile = objectValue(item);
    const alternatives = arrayValue(profile.alternatives);
    const rows = winnersOnly ? alternatives.filter((alternative) => Boolean(objectValue(alternative).winning)) : alternatives;
    if (winnersOnly && rows.length === 0) {
      return [];
    }
    return rows.map((alternativeItem) => {
      const alternative = objectValue(alternativeItem);
      const transportationAlternative = objectValue(alternative.transportationAlternative ?? {});
      const request = objectValue(transportationAlternative.request ?? {});
      const reuseLineage = objectValue(transportationAlternative.reuseLineage ?? {});
      return [
        scenarioName,
        textValue(profile.sourceReference) || textValue(profile.profileKey),
        textValue(profile.destination),
        textValue(request.destinationCountry),
        `${textValue(alternative.facilityId)} - ${textValue(alternative.facilityName)}`,
        formatSourceType(textValue(alternative.facilitySourceType)),
        csvNumber(alternative.representedShipments ?? profile.representedShipments),
        csvNumber(alternative.representedPallets ?? profile.representedPallets),
        csvNumber(alternative.modeledTransportationCost),
        csvNumber(alternative.warehouseCostUsedForAssignment),
        csvNumber(alternative.combinedAssignmentCost),
        ...(winnersOnly
          ? []
          : [
              arrayValue(alternative.missingReasons).join("; "),
              textValue(transportationAlternative.selectedRateSource),
              textValue(reuseLineage.sourceLaneId ?? transportationAlternative.laneId),
              textValue(reuseLineage.sourceBatchId ?? transportationAlternative.batchId)
            ])
      ];
    });
  });
}

function scenarioAlternativeRows(scenarioName: string, scenario: Record<string, unknown>) {
  return arrayValue(scenario.profileResults).flatMap((item) => {
    const profile = objectValue(item);
    return arrayValue(profile.alternatives).map((alternativeItem) => {
      const alternative = objectValue(alternativeItem);
      const transportationAlternative = objectValue(alternative.transportationAlternative ?? {});
      const selectedQuote = objectValue(transportationAlternative.selectedQuote ?? {});
      const reuseLineage = objectValue(transportationAlternative.reuseLineage ?? {});
      const selectedRate = numberValue(selectedQuote.total) ?? numberValue(transportationAlternative.selectedRate) ?? numberValue(transportationAlternative.reusedSelectedRate);
      return [
        scenarioName,
        deliveryLabel(profile),
        `${textValue(alternative.facilityId)} - ${textValue(alternative.facilityName)}`,
        formatSourceType(textValue(alternative.facilitySourceType)),
        textValue(selectedQuote.carrierName) || textValue(transportationAlternative.carrierName),
        csvNumber(selectedRate),
        Boolean(alternative.complete) ? "Complete" : "Incomplete",
        String(Boolean(alternative.winning)),
        csvNumber(alternative.representedShipments ?? profile.representedShipments),
        csvNumber(alternative.representedPallets ?? profile.representedPallets),
        csvNumber(alternative.modeledTransportationCost),
        csvNumber(alternative.warehouseCostUsedForAssignment),
        csvNumber(alternative.combinedAssignmentCost),
        arrayValue(alternative.missingReasons).join("; "),
        textValue(transportationAlternative.selectedRateSource),
        textValue(reuseLineage.sourceLaneId ?? transportationAlternative.laneId),
        textValue(reuseLineage.sourceBatchId ?? transportationAlternative.batchId)
      ];
    });
  });
}

function winningAssignmentsByDelivery(scenario: Record<string, unknown>) {
  const rows = new Map<string, {
    deliveryLabel: string;
    destination: string;
    country: string;
    sourceReference: string;
    representedShipments: number | null;
    representedPallets: number | null;
    warehouse: string;
    transportation: number | null;
  }>();
  for (const item of arrayValue(scenario.profileResults)) {
    const profile = objectValue(item);
    const winner = arrayValue(profile.alternatives).map(objectValue).find((alternative) => Boolean(alternative.winning));
    if (!winner) continue;
    const transportationAlternative = objectValue(winner.transportationAlternative ?? {});
    const request = objectValue(transportationAlternative.request ?? {});
    rows.set(deliveryKey(profile), {
      deliveryLabel: deliveryLabel(profile),
      destination: textValue(profile.destination),
      country: textValue(request.destinationCountry),
      sourceReference: textValue(profile.sourceReference),
      representedShipments: numberValue(winner.representedShipments) ?? numberValue(profile.representedShipments),
      representedPallets: numberValue(winner.representedPallets) ?? numberValue(profile.representedPallets),
      warehouse: `${textValue(winner.facilityId)} - ${textValue(winner.facilityName)}`,
      transportation: numberValue(winner.modeledTransportationCost)
    });
  }
  return rows;
}

function deliveryKey(profile: Record<string, unknown>) {
  return textValue(profile.destination) || textValue(profile.sourceReference) || textValue(profile.profileKey);
}

function deliveryLabel(profile: Record<string, unknown>) {
  return textValue(profile.destination) || textValue(profile.sourceReference) || textValue(profile.profileKey);
}

function formatFacilityLocation(run: ComparisonRun, scenarioKey: "A" | "B", facilityId: string, sourceType: string) {
  const scenario = run.scenarioInputs?.scenarios.find((item) => item.scenarioKey === scenarioKey);
  const facility = scenario?.selectedFacilities.find((item) => item.facilityId === facilityId && item.sourceType === sourceType);
  if (!facility) return "";
  return [facility.city, facility.stateProvince, facility.postalCode, facility.country].filter(Boolean).join(", ");
}

function requiredResult(run: ComparisonRun) {
  if (!run.resultSummary) throw new Error("Network Scenario Comparison result is not available.");
  return run.resultSummary;
}

function toCsv(rows: string[][]) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string) {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvNumber(value: unknown) {
  const number = numberValue(value);
  return number === null ? "" : String(number);
}

function comparisonInterpretation(result: { scenarioA: Record<string, unknown>; scenarioB: Record<string, unknown>; comparison: Record<string, unknown> }, scenarioAName: string, scenarioBName: string) {
  const lower = textValue(result.comparison.lowerCostScenario);
  const differenceValue = numberValue(result.comparison.totalDifference);
  if (!lower || differenceValue === null) return "Unavailable";
  const lowerName = lower === "A" ? scenarioAName : lower === "B" ? scenarioBName : lower;
  const higherName = lower === "A" ? scenarioBName : scenarioAName;
  const higherTotal = lower === "A" ? numberValue(result.scenarioB.totalNetworkCost) : numberValue(result.scenarioA.totalNetworkCost);
  const percent = higherTotal && higherTotal > 0 ? roundPercent(Math.abs(differenceValue) / higherTotal * 100) : null;
  const percentText = percent === null ? "" : ` (about ${percent.toFixed(1)}%)`;
  return `${lowerName} is ${Math.abs(differenceValue)} lower than ${higherName} for the represented demand${percentText}.`;
}

function sumNumbers(values: Array<number | null>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatSourceType(value: string) {
  if (value === "CURRENT") return "Current";
  if (value === "CANDIDATE") return "Candidate";
  return value;
}
