"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";

import type { WarehouseLocationStrategyResultSummary } from "@/modules/supply-chain-design/warehouse-location-strategy";

declare global {
  interface Window {
    maplibregl?: MapLibreApi;
  }
}

type MapLibreApi = {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  Marker: new (options?: Record<string, unknown>) => MapLibreMarker;
  Popup: new (options?: Record<string, unknown>) => MapLibrePopup;
  NavigationControl: new () => unknown;
  LngLatBounds: new () => MapLibreBounds;
};

type MapLibreMap = {
  addControl(control: unknown): void;
  on(event: string, callback: (event?: unknown) => void): void;
  on(event: string, layerId: string, callback: (event?: MapLayerEvent) => void): void;
  resize(): void;
  fitBounds(bounds: MapLibreBounds, options: Record<string, unknown>): void;
  getCanvas(): HTMLCanvasElement;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addSource(id: string, source: Record<string, unknown>): void;
  addLayer(layer: Record<string, unknown>): void;
  getLayer(id: string): unknown;
  remove(): void;
};

type MapLibreMarker = {
  setLngLat(value: [number, number]): MapLibreMarker;
  addTo(map: MapLibreMap): MapLibreMarker;
  remove(): void;
};

type MapLibrePopup = {
  setHTML(html: string): MapLibrePopup;
  setLngLat(value: [number, number]): MapLibrePopup;
  addTo(map: MapLibreMap): MapLibrePopup;
  remove(): void;
};

type MapLibreBounds = {
  extend(value: [number, number]): MapLibreBounds;
};

type MapLayerEvent = {
  features?: Array<{
    geometry?: { type?: string; coordinates?: unknown };
    properties?: Record<string, unknown>;
  }>;
  lngLat?: { lng: number; lat: number };
};

type PinPoint = {
  latitude: number;
  longitude: number;
  color: string;
  regionNumber: number;
  hoverHtml: string;
  html: string;
};

const MAPLIBRE_SCRIPT_URL = process.env.NEXT_PUBLIC_SCDS_MAPLIBRE_SCRIPT_URL ?? "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS_URL = process.env.NEXT_PUBLIC_SCDS_MAPLIBRE_CSS_URL ?? "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
// OpenFreeMap Liberty is the local-development fallback; production can override with NEXT_PUBLIC_SCDS_MAP_STYLE_URL.
const OPENFREEMAP_LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const configuredStyleUrl = process.env.NEXT_PUBLIC_SCDS_MAP_STYLE_URL?.trim();
const BASEMAP_STYLE_URL = configuredStyleUrl || OPENFREEMAP_LIBERTY_STYLE_URL;
const USING_OPENFREEMAP_FALLBACK = !configuredStyleUrl;
const SHOW_DEVELOPMENT_MAP_NOTICE = process.env.NODE_ENV !== "production" && USING_OPENFREEMAP_FALLBACK;
const DESTINATION_LAYER_ID = "location-strategy-destination-circles";

let maplibreLoad: Promise<MapLibreApi> | null = null;

export function WarehouseLocationStrategyMap({
  result,
  activeRunId,
  selectedSolutionId,
  onSolutionChange
}: {
  result: WarehouseLocationStrategyResultSummary;
  activeRunId: string;
  selectedSolutionId?: string | null;
  onSolutionChange?: (solutionId: string) => void;
}) {
  const recommendedId = result.recommendedSolution.solutionId;
  const selectedId = result.solutions.some((candidate) => candidate.solutionId === selectedSolutionId) ? selectedSolutionId! : recommendedId;
  const [solutionId, setSolutionId] = useState(selectedId);
  const solution = result.solutions.find((candidate) => candidate.solutionId === solutionId) ?? result.recommendedSolution;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRefs = useRef<MapLibrePopup[]>([]);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const destinationInteractionsAttachedRef = useRef(false);
  const mapData = useMemo(() => buildWarehouseLocationStrategyMapData(solution, result.weightingMethod), [solution, result.weightingMethod]);
  const hasOlderCanadianBroadOmissions = result.resultVersion !== "WAREHOUSE_LOCATION_STRATEGY_V4" &&
    result.resultVersion !== "WAREHOUSE_LOCATION_STRATEGY_V5" &&
    result.resultVersion !== "WAREHOUSE_LOCATION_STRATEGY_V6" &&
    result.resultVersion !== "WAREHOUSE_LOCATION_STRATEGY_V7" &&
    result.resultVersion !== "WAREHOUSE_LOCATION_STRATEGY_V8" &&
    result.resultVersion !== "WAREHOUSE_LOCATION_STRATEGY_V9" &&
    solution.assignments.some(
      (assignment) =>
        assignment.coordinatePrecision === "BROAD_CANADIAN_PROVINCE_MARKET" &&
        !isFiniteNumber(assignment.destinationLatitude) &&
        !isFiniteNumber(assignment.destinationLongitude)
    );
  const [mapError, setMapError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const metricLabel = formatMetricLabel(result.weightingMethod);

  useEffect(() => {
    setSolutionId(selectedId);
    clearTransientMapState(markerRefs, popupRefs);
  }, [activeRunId, selectedId]);

  useEffect(() => {
    let cancelled = false;
    setMapError(null);
    loadMapLibre().then((maplibre) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new maplibre.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE_URL,
        center: mapData.center,
        zoom: 3,
        attributionControl: true
      });
      map.addControl(new maplibre.NavigationControl());
      map.on("error", () => {
        if (!cancelled) setMapError("The map style could not be loaded. Retry, or refresh after checking the map provider.");
      });
      map.on("load", () => {
        mapRef.current = map;
        setMapError(null);
        renderMap(maplibre, map, mapData, markerRefs, popupRefs, destinationInteractionsAttachedRef);
      });
    }).catch(() => {
      if (!cancelled) setMapError("The map could not be loaded. Retry, or refresh after checking the map provider.");
    });
    return () => {
      cancelled = true;
      clearTransientMapState(markerRefs, popupRefs);
      destinationInteractionsAttachedRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mapData, retryKey]);

  useEffect(() => {
    if (!mapRef.current || !window.maplibregl) return;
    renderMap(window.maplibregl, mapRef.current, mapData, markerRefs, popupRefs, destinationInteractionsAttachedRef);
  }, [mapData]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Viewing: {solution.regionCount === 1 ? "One warehouse region" : solution.regionCount === 2 ? "Two warehouse regions" : "Three warehouse regions"} - weighted by {metricLabel}{solution.solutionId === recommendedId ? " (recommended)" : ""}</h4>
          <p className="text-xs text-mutedForeground">The map uses saved Location Strategy coordinates. Distances shown are straight-line miles.</p>
          <p className="mt-1 text-xs text-mutedForeground">The dashed circle contains approximately 85% of the selected weighted demand assigned to that region. Destinations outside the circle may still be assigned to the region.</p>
        </div>
        <label className="text-sm font-semibold text-foreground">
          View solution{" "}
          <select value={solution.solutionId} onChange={(event) => {
            const nextSolutionId = event.target.value;
            if (nextSolutionId === solution.solutionId) return;
            setSolutionId(nextSolutionId);
            if (onSolutionChange) {
              onSolutionChange(nextSolutionId);
            } else {
              const url = new URL(window.location.href);
              url.searchParams.set("tab", "warehouse-location-strategy");
              url.searchParams.set("locationStrategySolutionId", nextSolutionId);
              window.history.replaceState(window.history.state, "", url.toString());
            }
          }} className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
            {result.solutions.map((candidate) => (
              <option key={candidate.solutionId} value={candidate.solutionId}>
                {candidate.country ? `${candidate.country} - ` : ""}{candidate.regionCount === 1 ? "One warehouse region" : candidate.regionCount === 2 ? "Two warehouse regions" : "Three warehouse regions"}{candidate.solutionId === recommendedId ? " (recommended)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => mapRef.current && fitMap(mapRef.current, mapData)} className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted">Reset view</button>
      </div>
      <div ref={containerRef} className="h-[620px] min-h-[460px] rounded-md border border-border bg-muted max-sm:h-[480px] max-sm:min-h-[420px]" data-map-style-url={BASEMAP_STYLE_URL}>
        <div className="p-4 text-sm text-mutedForeground">
          Loading interactive map.
        </div>
      </div>
      {mapError ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <p>{mapError}</p>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-2 rounded-md border border-danger px-3 py-1 text-xs font-semibold">
            Retry map
          </button>
        </div>
      ) : null}
      {mapData.omittedDestinationCount > 0 ? (
        <p className="text-xs text-mutedForeground">{formatNumber(mapData.omittedDestinationCount)} broad or unresolved {mapData.omittedDestinationCount === 1 ? "destination is" : "destinations are"} not shown as precise map {mapData.omittedDestinationCount === 1 ? "point" : "points"}.</p>
      ) : null}
      {hasOlderCanadianBroadOmissions ? (
        <p className="text-xs text-mutedForeground">This older report does not contain Canadian broad-market map coordinates. Run the analysis again to display them.</p>
      ) : null}
      <MapLegend solution={solution} metricLabel={metricLabel} hasBroadCanadianDestinations={mapData.hasBroadCanadianDestinations} />
      {SHOW_DEVELOPMENT_MAP_NOTICE ? (
        <p className="text-xs text-mutedForeground">Development basemap: OpenFreeMap Liberty.</p>
      ) : null}
    </div>
  );
}

function renderMap(
  maplibre: MapLibreApi,
  map: MapLibreMap,
  data: ReturnType<typeof buildWarehouseLocationStrategyMapData>,
  markerRefs: MutableRefObject<MapLibreMarker[]>,
  popupRefs: MutableRefObject<MapLibrePopup[]>,
  destinationInteractionsAttachedRef: MutableRefObject<boolean>
) {
  clearTransientMapState(markerRefs, popupRefs);
  upsertSource(map, "location-strategy-destinations", data.destinations);
  upsertSource(map, "location-strategy-radii", data.radii);
  addLayer(map, {
    id: "location-strategy-radii-fill",
    type: "fill",
    source: "location-strategy-radii",
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 }
  });
  addLayer(map, {
    id: "location-strategy-radii-outline",
    type: "line",
    source: "location-strategy-radii",
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2] }
  });
  addLayer(map, {
    id: DESTINATION_LAYER_ID,
    type: "circle",
    source: "location-strategy-destinations",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["get", "radius"],
      "circle-opacity": 0.86,
      "circle-stroke-color": ["case", ["get", "canadianDestination"], "#111827", "#ffffff"],
      "circle-stroke-width": ["case", ["get", "canadianDestination"], 3, 1.5]
    }
  });
  markerRefs.current = [
    ...data.centerPins.map((point) => createPinMarker(maplibre, map, popupRefs, point, "center")),
    ...data.marketPins.map((point) => createPinMarker(maplibre, map, popupRefs, point, "market"))
  ];
  if (!destinationInteractionsAttachedRef.current) {
    attachDestinationInteractions(maplibre, map, popupRefs);
    destinationInteractionsAttachedRef.current = true;
  }
  fitMap(map, data);
  map.resize();
}

function createPinMarker(
  maplibre: MapLibreApi,
  map: MapLibreMap,
  popupRefs: MutableRefObject<MapLibrePopup[]>,
  point: PinPoint,
  kind: "center" | "market"
) {
  const element = pinElement(kind, point.color, point.regionNumber);
  const openPopup = (persistent: boolean) => {
    clearPopups(popupRefs);
    popupRefs.current = [
      new maplibre.Popup({ closeButton: persistent, closeOnClick: persistent, offset: 14 })
        .setLngLat([point.longitude, point.latitude])
        .setHTML(persistent ? point.html : point.hoverHtml)
        .addTo(map)
    ];
  };
  element.addEventListener("mouseenter", () => openPopup(false));
  element.addEventListener("mouseleave", () => clearPopups(popupRefs));
  element.addEventListener("focus", () => openPopup(false));
  element.addEventListener("blur", () => clearPopups(popupRefs));
  element.addEventListener("click", () => openPopup(true));
  return new maplibre.Marker({
    element,
    anchor: "bottom"
  })
    .setLngLat([point.longitude, point.latitude])
    .addTo(map);
}

function pinElement(kind: "center" | "market", colorValue: string, regionNumber: number) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "scds-location-strategy-pin";
  element.dataset.markerKind = kind;
  element.dataset.regionNumber = String(regionNumber);
  element.setAttribute("aria-label", kind === "center" ? `Calculated demand center - Region ${regionNumber}` : `Recommended warehouse market - Region ${regionNumber}`);
  element.style.width = kind === "center" ? "24px" : "30px";
  element.style.height = kind === "center" ? "30px" : "38px";
  element.style.border = "0";
  element.style.padding = "0";
  element.style.background = "transparent";
  element.style.cursor = "pointer";
  element.style.pointerEvents = "auto";
  element.innerHTML = pinSvg(kind === "center" ? "#111827" : colorValue, kind === "center" ? 24 : 30, kind === "center" ? 30 : 38);
  return element;
}

function pinSvg(fill: string, width: number, height: number) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 30 38" aria-hidden="true" focusable="false" style="display:block;overflow:visible"><path d="M15 37C11 30 4 23 4 14.5C4 7.6 8.9 2 15 2s11 5.6 11 12.5C26 23 19 30 15 37Z" fill="${fill}" stroke="#ffffff" stroke-width="3"/><path d="M15 37C11 30 4 23 4 14.5C4 7.6 8.9 2 15 2s11 5.6 11 12.5C26 23 19 30 15 37Z" fill="none" stroke="#111827" stroke-width="1"/><circle cx="15" cy="14.5" r="4.8" fill="#ffffff"/></svg>`;
}

function attachDestinationInteractions(maplibre: MapLibreApi, map: MapLibreMap, popupRefs: MutableRefObject<MapLibrePopup[]>) {
  map.on("mouseenter", DESTINATION_LAYER_ID, (event) => {
    map.getCanvas().style.cursor = "pointer";
    const feature = event?.features?.[0];
    const coordinates = featureCoordinates(feature, event);
    const html = typeof feature?.properties?.hoverHtml === "string" ? feature.properties.hoverHtml : "";
    if (!coordinates || !html) return;
    clearPopups(popupRefs);
    popupRefs.current = [
      new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
        .setLngLat(coordinates)
        .setHTML(html)
        .addTo(map)
    ];
  });
  map.on("mouseleave", DESTINATION_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
    clearPopups(popupRefs);
  });
  map.on("click", DESTINATION_LAYER_ID, (event) => {
    const feature = event?.features?.[0];
    const coordinates = featureCoordinates(feature, event);
    const html = typeof feature?.properties?.html === "string" ? feature.properties.html : "";
    if (!coordinates || !html) return;
    clearPopups(popupRefs);
    popupRefs.current = [
      new maplibre.Popup({ closeButton: true, closeOnClick: true, offset: 12 })
        .setLngLat(coordinates)
        .setHTML(html)
        .addTo(map)
    ];
  });
}

type MapLayerFeature = NonNullable<MapLayerEvent["features"]>[number];

function featureCoordinates(feature: MapLayerFeature | undefined, event: MapLayerEvent | undefined): [number, number] | null {
  const coordinates = feature?.geometry?.coordinates;
  if (Array.isArray(coordinates) && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return [coordinates[0], coordinates[1]];
  }
  if (event?.lngLat) return [event.lngLat.lng, event.lngLat.lat];
  return null;
}

function upsertSource(map: MapLibreMap, id: string, data: unknown) {
  const source = map.getSource(id);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(id, { type: "geojson", data });
}

function addLayer(map: MapLibreMap, layer: Record<string, unknown>) {
  if (!map.getLayer(String(layer.id))) map.addLayer(layer);
}

function clearTransientMapState(markerRefs: MutableRefObject<MapLibreMarker[]>, popupRefs: MutableRefObject<MapLibrePopup[]>) {
  markerRefs.current.forEach((marker) => marker.remove());
  markerRefs.current = [];
  clearPopups(popupRefs);
}

function clearPopups(popupRefs: MutableRefObject<MapLibrePopup[]>) {
  popupRefs.current.forEach((popup) => popup.remove());
  popupRefs.current = [];
}

function fitMap(map: MapLibreMap, data: ReturnType<typeof buildWarehouseLocationStrategyMapData>) {
  if (!window.maplibregl || data.bounds.length === 0) return;
  const bounds = new window.maplibregl.LngLatBounds();
  data.bounds.forEach((point) => bounds.extend([point.longitude, point.latitude]));
  map.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 });
}

export function buildWarehouseLocationStrategyMapData(solution: WarehouseLocationStrategyResultSummary["solutions"][number], weightingMethod: string) {
  const maxWeight = Math.max(1, ...solution.assignments.map((assignment) => assignment.selectedWeight));
  const destinationGroups = aggregateDestinationMarkers(solution);
  const omittedDestinationCount = destinationGroups.filter((assignments) => !resolveDestinationMapPoint(assignments[0])).length;
  const destinationMarkers = destinationGroups.flatMap((assignments, index) => {
    const group = { assignments };
    const assignment = group.assignments[0];
    const destinationPoint = resolveDestinationMapPoint(assignment);
    if (!destinationPoint) return [];
    const selectedWeight = group.assignments.reduce((total, row) => total + row.selectedWeight, 0);
    const shipments = group.assignments.reduce((total, row) => total + row.shipmentsRepresented, 0);
    const distance = weightedAverage(group.assignments.map((row) => ({ value: row.distanceToCenter, weight: row.selectedWeight })));
    const label = destinationPoint.broad ? assignment.destinationMarketLabel ?? destinationPlaceLabel(assignment) : destinationPlaceLabel(assignment);
    const canadianDestination = group.assignments.some((row) => row.destinationCountry === "CA");
    const sourceReferences = group.assignments.map((row) => row.sourceReference).slice(0, 8).join(", ");
    const postalCodes = uniqueList(group.assignments.map((row) => row.destinationPostalCode)).sort((left, right) => left.localeCompare(right));
    const recordTypes = uniqueList(group.assignments.map((row) => row.recordType)).sort((left, right) => left.localeCompare(right));
    const transportationModes = uniqueList(group.assignments.map((row) => row.transportationMode ?? "Not supplied")).sort((left, right) => left.localeCompare(right));
    const selectedMetricHtml = selectedMetricLine(weightingMethod, selectedWeight);
    const broadHoverDetails = destinationPoint.broad
      ? `<br/>Province: ${escapeHtml(broadProvinceLabel(group.assignments))}<br/>Broad Canadian market approximation`
      : "";
    const broadPopupDetails = destinationPoint.broad
      ? "<br/>Broad Canadian market approximation<br/>This marker represents multiple Canadian destinations using the approved broad market coordinate. It is not a precise postal location."
      : "";
    return [{
      latitude: destinationPoint.latitude,
      longitude: destinationPoint.longitude,
      color: color(assignment.assignedRegion - 1),
      regionNumber: assignment.assignedRegion,
      radius: destinationRadius(selectedWeight, maxWeight),
      broad: destinationPoint.broad,
      canadianDestination,
      hoverHtml: `<strong>${escapeHtml(label)}</strong>${canadianDestination && !destinationPoint.broad ? `<br/>Province: ${escapeHtml(broadProvinceLabel(group.assignments))}` : broadHoverDetails}<br/>Source profiles: ${formatNumber(group.assignments.length)}<br/>${formatDestinationListLabel(postalCodes)}: ${escapeHtml(postalCodes.join(", "))}<br/>Shipments represented: ${formatNumber(shipments)}${selectedMetricHtml}<br/>Assigned region: ${assignment.assignedRegion}`,
      html: `<strong>${escapeHtml(label)}</strong>${canadianDestination && !destinationPoint.broad ? `<br/>Province: ${escapeHtml(broadProvinceLabel(group.assignments))}` : broadPopupDetails}<br/>Source profiles: ${formatNumber(group.assignments.length)}<br/>Source references: ${escapeHtml(sourceReferences)}${group.assignments.length > 8 ? "..." : ""}<br/>${formatDestinationListLabel(postalCodes)}: ${escapeHtml(postalCodes.join(", "))}<br/>${formatListLabel("Record type", recordTypes)}: ${escapeHtml(recordTypes.join(", "))}<br/>${formatListLabel("Transportation mode", transportationModes)}: ${escapeHtml(transportationModes.join(", "))}<br/>Shipments represented: ${formatNumber(shipments)}${selectedMetricHtml}<br/>Assigned region: ${assignment.assignedRegion}<br/>Straight-line distance: ${formatNumber(distance)} miles`,
      index
    }];
  });
  const centerPins = solution.regions.map((region) => {
    const nearbyMarketNote = hasNearbyMarket(region) ? "<br/>The recommended practical market may be near this calculated center." : "";
    return {
      latitude: region.centerLatitude,
      longitude: region.centerLongitude,
      color: "#111827",
      regionNumber: region.regionNumber,
      hoverHtml: `<strong>Calculated demand center - Region ${region.regionNumber}</strong>${nearbyMarketNote}`,
      html: `<strong>Calculated demand center - Region ${region.regionNumber}</strong><br/>Saved coordinates: ${region.centerLatitude}, ${region.centerLongitude}<br/>This point drives assignment.${nearbyMarketNote}`
    };
  });
  const marketPins = solution.regions.flatMap((region, index) =>
    region.recommendedMarketLatitude !== null && region.recommendedMarketLongitude !== null
      ? [{
          latitude: region.recommendedMarketLatitude,
          longitude: region.recommendedMarketLongitude,
          color: color(index),
          regionNumber: region.regionNumber,
          hoverHtml: `<strong>${escapeHtml(region.recommendedMarketLabel)}</strong><br/>Recommended practical warehouse market<br/>${formatMarketDistance(region)}`,
          html: `<strong>${escapeHtml(region.recommendedMarketLabel)}</strong><br/>Recommended practical warehouse market<br/>${formatMarketDistance(region)}<br/>This is the nearest supported market, not the mathematical center.${hasNearbyMarket(region) ? "<br/>This market may be near the calculated center." : ""}`
        }]
      : []
  );
  const radii = featureCollection(solution.regions.flatMap((region, index) =>
    region.searchRadiusMiles === null ? [] : [circleFeature(region.centerLongitude, region.centerLatitude, region.searchRadiusMiles, color(index))]
  ));
  const bounds = [
    ...destinationMarkers,
    ...centerPins,
    ...marketPins
  ];
  return {
    center: averageLngLat(bounds),
    bounds,
    destinationMarkers,
    centerPins,
    marketPins,
    omittedDestinationCount,
    hasBroadCanadianDestinations: destinationMarkers.some((point) => point.broad),
    destinations: featureCollection(destinationMarkers.map((point) => pointFeature(point.longitude, point.latitude, {
      kind: "destination",
      color: point.color,
      regionNumber: point.regionNumber,
      radius: point.radius,
      hoverHtml: point.hoverHtml,
      html: point.html,
      broad: point.broad,
      canadianDestination: point.canadianDestination
    }))),
    radii
  };
}

function MapLegend({
  solution,
  metricLabel,
  hasBroadCanadianDestinations
}: {
  solution: WarehouseLocationStrategyResultSummary["solutions"][number];
  metricLabel: string;
  hasBroadCanadianDestinations: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs text-mutedForeground">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="font-semibold text-foreground">Map symbols</p>
          <div className="mt-2 space-y-2">
            <LegendItem swatch={<MultiColorDestinationLegend />} label="Delivery destination - colored by assigned region" />
            <LegendItem swatch={<PinLegend color="#111827" size="small" />} label="Calculated demand center" />
            <LegendItem swatch={<PinLegend color="#2563eb" size="large" />} label="Recommended practical warehouse market - colored by assigned region" />
            <LegendItem swatch={<MultiColorRadiusLegend />} label="85% demand coverage radius - colored by assigned region" />
            {hasBroadCanadianDestinations ? <LegendItem swatch={<BroadCanadianDestinationLegend />} label="Canadian broad-market destination - approximate location" /> : null}
          </div>
        </div>
        <div>
          <p className="font-semibold text-foreground">Assigned regions</p>
          <div className="mt-2 space-y-2">
            {solution.regions.map((region, index) => (
              <LegendItem key={region.regionId} swatch={<span className="inline-block h-3 w-3 rounded-sm border border-foreground" style={{ backgroundColor: color(index) }} />} label={`Region ${region.regionNumber}`} />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-mutedForeground">Destination size represents: {metricLabel}.</p>
    </div>
  );
}

function PinLegend({ color: colorValue, size }: { color: string; size: "small" | "large" }) {
  return <span className="inline-block align-middle" dangerouslySetInnerHTML={{ __html: pinSvg(colorValue, size === "small" ? 12 : 14, size === "small" ? 16 : 18) }} />;
}

function MultiColorDestinationLegend() {
  return (
    <span className="inline-flex items-center -space-x-1">
      <span className="inline-block h-3 w-3 rounded-full border border-white bg-[#2563eb] shadow-[0_0_0_1px_rgba(17,24,39,0.7)]" />
      <span className="inline-block h-3 w-3 rounded-full border border-white bg-[#dc2626] shadow-[0_0_0_1px_rgba(17,24,39,0.7)]" />
    </span>
  );
}

function MultiColorRadiusLegend() {
  return (
    <span className="inline-flex items-center -space-x-1">
      <span className="inline-block h-3 w-5 rounded-full border-2 border-dashed border-[#2563eb] bg-[#2563eb]/10" />
      <span className="inline-block h-3 w-5 rounded-full border-2 border-dashed border-[#dc2626] bg-[#dc2626]/10" />
    </span>
  );
}

function BroadCanadianDestinationLegend() {
  return <span className="inline-block h-3 w-3 rounded-full border-[3px] border-foreground bg-[#2563eb]" />;
}

function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {swatch}
      <span>{label}</span>
    </div>
  );
}

function aggregateDestinationMarkers(solution: WarehouseLocationStrategyResultSummary["solutions"][number]) {
  const groups = new Map<string, typeof solution.assignments>();
  for (const assignment of solution.assignments) {
    const point = resolveDestinationMapPoint(assignment);
    const key = point
      ? `${assignment.assignedRegion}:${point.latitude}:${point.longitude}`
      : `omitted:${assignment.assignedRegion}:${assignment.destinationPostalCode}:${assignment.coordinatePrecision}`;
    groups.set(key, [...(groups.get(key) ?? []), assignment]);
  }
  return [...groups.values()];
}

function resolveDestinationMapPoint(
  assignment: WarehouseLocationStrategyResultSummary["solutions"][number]["assignments"][number]
) {
  if (isFiniteNumber(assignment.destinationLatitude) && isFiniteNumber(assignment.destinationLongitude)) {
    return {
      latitude: assignment.destinationLatitude,
      longitude: assignment.destinationLongitude,
      broad: assignment.coordinatePrecision === "BROAD_CANADIAN_PROVINCE_MARKET" || assignment.destinationBroadApproximation === true
    };
  }
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function destinationPlaceLabel(assignment: WarehouseLocationStrategyResultSummary["solutions"][number]["assignments"][number]) {
  return assignment.destinationLabel || `${assignment.destinationPostalCode} ${assignment.destinationCountry}`;
}

function selectedMetricLine(weightingMethod: string, selectedWeight: number) {
  if (weightingMethod === "SHIPMENTS_REPRESENTED") return "";
  return `<br/>${escapeHtml(formatMetricLabel(weightingMethod))}: ${formatNumber(selectedWeight)}`;
}

function formatDestinationListLabel(values: string[]) {
  return values.length === 1 ? "Distinct destination" : "Distinct destinations";
}

function formatListLabel(singular: string, values: string[]) {
  return values.length === 1 ? singular : `${singular}s`;
}

function broadProvinceLabel(assignments: WarehouseLocationStrategyResultSummary["solutions"][number]["assignments"]) {
  return uniqueList(assignments.map((assignment) => {
    return assignment.destinationProvince || assignment.destinationPostalCode.slice(0, 3).toUpperCase() || "Canada";
  })).join(", ");
}

function destinationRadius(weight: number, maxWeight: number) {
  return Math.max(6, Math.min(18, 6 + Math.sqrt(weight / Math.max(1, maxWeight)) * 12));
}

function hasNearbyMarket(region: WarehouseLocationStrategyResultSummary["solutions"][number]["regions"][number]) {
  if (region.recommendedMarketLatitude === null || region.recommendedMarketLongitude === null) return false;
  return Math.abs(region.centerLatitude - region.recommendedMarketLatitude) < 0.75 &&
    Math.abs(region.centerLongitude - region.recommendedMarketLongitude) < 0.75;
}

function formatMarketDistance(region: WarehouseLocationStrategyResultSummary["solutions"][number]["regions"][number]) {
  return region.broadRegionApproximation ? "Broad Canadian major-market approximation." : `${formatNumber(region.recommendedMarketDistanceMiles ?? 0)} miles from calculated demand center.`;
}

function weightedAverage(rows: Array<{ value: number; weight: number }>) {
  const totalWeight = rows.reduce((total, row) => total + row.weight, 0);
  if (!totalWeight) return 0;
  return rows.reduce((total, row) => total + row.value * row.weight, 0) / totalWeight;
}

function uniqueList(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function formatMetricLabel(value: string) {
  if (value === "PALLETS") return "Pallets represented";
  if (value === "WEIGHT") return "Weight represented";
  if (value === "UNITS") return "Units represented";
  if (value === "CURRENT_TRANSPORTATION_COST") return "Historical transportation spend";
  return "Shipments represented";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (maplibreLoad) return maplibreLoad;
  maplibreLoad = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = MAPLIBRE_CSS_URL;
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = MAPLIBRE_SCRIPT_URL;
    script.async = true;
    script.onload = () => window.maplibregl ? resolve(window.maplibregl) : reject(new Error("MapLibre was not available after loading."));
    script.onerror = () => reject(new Error("MapLibre script failed to load."));
    document.head.appendChild(script);
  });
  return maplibreLoad;
}

function featureCollection(features: unknown[]) {
  return { type: "FeatureCollection", features };
}

function pointFeature(longitude: number, latitude: number, properties: Record<string, unknown>) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [longitude, latitude] }, properties };
}

function circleFeature(longitude: number, latitude: number, radiusMiles: number, colorValue: string) {
  const coordinates = Array.from({ length: 65 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2;
    const lat = latitude + (radiusMiles / 69) * Math.sin(angle);
    const lon = longitude + (radiusMiles / (69 * Math.max(0.25, Math.cos(latitude * Math.PI / 180)))) * Math.cos(angle);
    return [lon, lat];
  });
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coordinates] }, properties: { color: colorValue } };
}

function averageLngLat(points: Array<{ latitude: number; longitude: number }>): [number, number] {
  if (points.length === 0) return [-96, 39];
  return [
    points.reduce((total, point) => total + point.longitude, 0) / points.length,
    points.reduce((total, point) => total + point.latitude, 0) / points.length
  ];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character] ?? character));
}

function color(index: number) {
  return ["#2563eb", "#dc2626", "#059669", "#7c3aed"][index % 4];
}
