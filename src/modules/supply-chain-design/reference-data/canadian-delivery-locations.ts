export const CANADIAN_DELIVERY_LOCATION_SOURCE = "NEWL_CANADIAN_DELIVERY_CITY_REFERENCE_V1";

export type CanadianDeliveryLocation = {
  city: string;
  provinceCode: string;
  latitude: number;
  longitude: number;
  aliases?: string[];
};

export const CANADIAN_DELIVERY_LOCATIONS: CanadianDeliveryLocation[] = [
  city("Calgary", "AB", 51.0447, -114.0719),
  city("Edmonton", "AB", 53.5461, -113.4938),
  city("Vancouver", "BC", 49.2827, -123.1207),
  city("Victoria", "BC", 48.4284, -123.3656),
  city("Winnipeg", "MB", 49.8951, -97.1384),
  city("Moncton", "NB", 46.0878, -64.7782),
  city("St. John's", "NL", 47.5615, -52.7126, ["St Johns"]),
  city("Halifax", "NS", 44.6488, -63.5752),
  city("Toronto", "ON", 43.6532, -79.3832),
  city("Mississauga", "ON", 43.589, -79.6441),
  city("Ottawa", "ON", 45.4215, -75.6972),
  city("Charlottetown", "PE", 46.2382, -63.1311),
  city("Montreal", "QC", 45.5019, -73.5674),
  city("Quebec City", "QC", 46.8139, -71.208),
  city("Regina", "SK", 50.4452, -104.6189),
  city("Saskatoon", "SK", 52.1579, -106.6702)
];

export function resolveCanadianDeliveryCity(value: string | null, provinceCode: string | null) {
  if (!value || !provinceCode) return null;
  const normalizedCity = normalizeCanadianCity(value, provinceCode);
  const normalizedProvince = provinceCode.trim().toUpperCase();
  return CANADIAN_DELIVERY_LOCATIONS.find((location) =>
    location.provinceCode === normalizedProvince &&
    [location.city, ...(location.aliases ?? [])].some((candidate) => normalizeText(candidate) === normalizedCity)
  ) ?? null;
}

export function nearestCanadianDeliveryLocation(latitude: number, longitude: number) {
  return [...CANADIAN_DELIVERY_LOCATIONS]
    .map((location) => ({
      location,
      distanceScore: Math.hypot(location.latitude - latitude, location.longitude - longitude)
    }))
    .sort((left, right) => left.distanceScore - right.distanceScore || left.location.provinceCode.localeCompare(right.location.provinceCode) || left.location.city.localeCompare(right.location.city))[0]?.location ?? null;
}

function city(
  cityName: string,
  provinceCode: string,
  latitude: number,
  longitude: number,
  aliases?: string[]
): CanadianDeliveryLocation {
  return { city: cityName, provinceCode, latitude, longitude, aliases };
}

function normalizeCanadianCity(value: string, provinceCode: string) {
  return normalizeText(value)
    .replace(new RegExp(`\\b${provinceCode.trim().toUpperCase()}\\b`, "g"), "")
    .replace(/\b(EXPANSION|REPEAT|SATELLITE|SMALL PARCEL)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .trim()
    .toUpperCase();
}
