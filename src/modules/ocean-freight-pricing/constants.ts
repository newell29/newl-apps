import { OceanEquipmentType, OceanRateStatus } from "@prisma/client";

export const OCEAN_EQUIPMENT_LABELS: Record<OceanEquipmentType, string> = {
  [OceanEquipmentType.TWENTY_FT]: "20' / 20GP",
  [OceanEquipmentType.FORTY_FT]: "40' / 40GP",
  [OceanEquipmentType.FORTY_HQ]: "40HQ",
  [OceanEquipmentType.FORTY_FIVE_HQ]: "45HQ",
  [OceanEquipmentType.LCL]: "LCL",
  [OceanEquipmentType.OTHER]: "Other"
};

export const OCEAN_RATE_STATUS_LABELS: Record<OceanRateStatus | "FUTURE" | "NEEDS_VALIDITY", string> = {
  [OceanRateStatus.ACTIVE]: "Active",
  [OceanRateStatus.EXPIRED]: "Expired",
  [OceanRateStatus.INACTIVE]: "Inactive",
  [OceanRateStatus.SUPERSEDED]: "Superseded",
  FUTURE: "Future valid",
  NEEDS_VALIDITY: "Needs validity"
};
