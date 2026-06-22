type TradeMiningDataQualityRecord = {
  id: string;
  rawRecordKey: string;
  arrivalDate: Date | null;
  importerName: string | null;
  consigneeName: string | null;
  shipperName: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  originCountry: string | null;
  productDescription: string | null;
  rawJson: unknown;
  company?: {
    name: string;
  } | null;
};

type CoverageDefinition = {
  key: string;
  label: string;
  description: string;
  critical: boolean;
  hasValue(record: TradeMiningDataQualityRecord): boolean;
};

const coverageDefinitions: CoverageDefinition[] = [
  {
    key: "companyIdentity",
    label: "Company identity",
    description: "Importer, consignee, shipper, or matched company name",
    critical: true,
    hasValue(record) {
      return Boolean(
        normalizeString(record.importerName) ??
          normalizeString(record.consigneeName) ??
          normalizeString(record.shipperName) ??
          readAnyString(record.rawJson, [
            "companyMatchName",
            "importerName",
            "consigneeName",
            "shipperName",
            "importer_name",
            "consignee_name",
            "shipper_name"
          ]) ??
          record.company?.name
      );
    }
  },
  {
    key: "shipmentDate",
    label: "Shipment date",
    description: "Arrival/shipment date used for recency and momentum",
    critical: true,
    hasValue(record) {
      return Boolean(
        record.arrivalDate ??
          readAnyString(record.rawJson, ["shipmentDate", "arrivalDate", "shipment_date", "arrival_date"])
      );
    }
  },
  {
    key: "destinationSignal",
    label: "Destination signal",
    description: "Destination market, port, city/state, or ZIP",
    critical: true,
    hasValue(record) {
      return Boolean(
        normalizeString(record.destinationCity) ??
          normalizeString(record.destinationState) ??
          readAnyString(record.rawJson, [
            "destinationMarket",
            "destinationPort",
            "arrivalPort",
            "destinationCity",
            "destinationState",
            "destinationZip",
            "destination_market",
            "destination_port",
            "arrival_port",
            "destination_city",
            "destination_state",
            "destination_zip"
          ])
      );
    }
  },
  {
    key: "originSignal",
    label: "Origin signal",
    description: "Origin country/port, foreign port, or place of receipt",
    critical: true,
    hasValue(record) {
      return Boolean(
        normalizeString(record.originCountry) ??
          readAnyString(record.rawJson, [
            "originCountry",
            "originPort",
            "foreignPort",
            "shipFromPort",
            "placeOfReceipt",
            "origin_country",
            "origin_port",
            "foreign_port",
            "ship_from_port",
            "place_of_receipt"
          ])
      );
    }
  },
  {
    key: "productSignal",
    label: "Product / HS code",
    description: "Product description or HS code fit",
    critical: true,
    hasValue(record) {
      return Boolean(
        normalizeString(record.productDescription) ??
          readAnyString(record.rawJson, [
            "productDescription",
            "hsCode",
            "product_description",
            "hs_code"
          ])
      );
    }
  },
  {
    key: "volumeSignal",
    label: "Volume signal",
    description: "TEU, containers, weight, quantity, or volume",
    critical: true,
    hasValue(record) {
      return hasAnyPositiveNumber(record.rawJson, [
        "teu",
        "containerCount",
        "weight",
        "quantity",
        "volume",
        "container_count",
        "shipmentWeight",
        "shipment_weight"
      ]);
    }
  },
  {
    key: "carrierSignal",
    label: "Carrier / vessel",
    description: "Carrier, vessel, or voyage context",
    critical: false,
    hasValue(record) {
      return Boolean(
        readAnyString(record.rawJson, [
          "carrier",
          "vessel",
          "voyage",
          "carrier_name"
        ])
      );
    }
  },
  {
    key: "referenceSignal",
    label: "Reference IDs",
    description: "BOL, container number, or bill type",
    critical: false,
    hasValue(record) {
      return Boolean(
        readAnyString(record.rawJson, [
          "bolNumber",
          "houseBolNumber",
          "masterBolNumber",
          "containerNumber",
          "billType",
          "bol_number",
          "house_bol_number",
          "master_bol_number",
          "container_number",
          "bill_type"
        ])
      );
    }
  }
];

export function summarizeTradeMiningDataQuality(records: TradeMiningDataQualityRecord[]) {
  const coverage = coverageDefinitions.map((definition) => {
    const presentCount = records.filter((record) => definition.hasValue(record)).length;

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      critical: definition.critical,
      presentCount,
      missingCount: Math.max(0, records.length - presentCount),
      coveragePercent: records.length === 0 ? 0 : Math.round((presentCount / records.length) * 100)
    };
  });

  const criticalDefinitions = coverageDefinitions.filter((definition) => definition.critical);
  const scoreReadyCount = records.filter((record) => criticalDefinitions.every((definition) => definition.hasValue(record))).length;
  const samples = records.slice(0, 12).map((record) => {
    const missingFields = criticalDefinitions
      .filter((definition) => !definition.hasValue(record))
      .map((definition) => definition.label);

    return {
      id: record.id,
      rawRecordKey: record.rawRecordKey,
      companyName:
        record.company?.name ??
        normalizeString(record.importerName) ??
        normalizeString(record.consigneeName) ??
        normalizeString(record.shipperName) ??
        readAnyString(record.rawJson, ["companyMatchName", "importerName", "consigneeName", "shipperName"]) ??
        "Unknown company",
      arrivalDate: record.arrivalDate,
      destinationLabel:
        [
          normalizeString(record.destinationCity),
          normalizeString(record.destinationState)
        ]
          .filter(Boolean)
          .join(", ") ||
        readAnyString(record.rawJson, ["destinationMarket", "destinationPort", "arrivalPort"]) ||
        "Unknown destination",
      missingFields
    };
  });

  return {
    summary: {
      sampleSize: records.length,
      scoreReadyCount,
      attentionCount: Math.max(0, records.length - scoreReadyCount)
    },
    coverage,
    samples
  };
}

function readAnyString(value: unknown, keys: string[]) {
  for (const candidate of getCandidateObjects(value)) {
    for (const key of keys) {
      const field = candidate[key];

      if (typeof field === "string" && field.trim()) {
        return field.trim();
      }
    }
  }

  return null;
}

function hasAnyPositiveNumber(value: unknown, keys: string[]) {
  for (const candidate of getCandidateObjects(value)) {
    for (const key of keys) {
      const field = candidate[key];

      if (typeof field === "number" && Number.isFinite(field) && field > 0) {
        return true;
      }
    }
  }

  return false;
}

function getCandidateObjects(value: unknown) {
  const root = asObject(value);
  const record = asObject(root.record);
  const rawData = asObject(root.rawData);
  const rawDataRecord = asObject(rawData.record);

  return [root, record, rawData, rawDataRecord].filter((candidate) => Object.keys(candidate).length > 0);
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeString(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
