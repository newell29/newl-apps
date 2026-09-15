export const NEWL_LOGISTICS_MARKET_PROOF_CATALOGUE_VERSION = "NEWL_LOGISTICS_MARKETS_PROOF_V1";
export const NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION = "NEWL_LOGISTICS_MARKETS_V2";

export type NewlLogisticsMarketTier = "PRIMARY" | "SECONDARY" | "CANADA_PROVINCE_LEVEL";

export type NewlLogisticsMarketCatalogueRow = {
  marketId: string;
  marketName: string;
  representativeMajorCity: string;
  stateProvince: string;
  country: "US" | "CA";
  latitude: number;
  longitude: number;
  activeEligible: boolean;
  tier: NewlLogisticsMarketTier;
  marketType: string;
  rationale: string;
  catalogueVersion: string;
};

export const NEWL_LOGISTICS_MARKET_PROOF_CATALOGUE: NewlLogisticsMarketCatalogueRow[] = [
  us("US-ATL", "Atlanta", "Atlanta", "GA", 33.749, -84.388, "PRIMARY", "Proof benchmark market."),
  us("US-CHI", "Chicago", "Chicago", "IL", 41.8781, -87.6298, "PRIMARY", "Proof benchmark market."),
  us("US-CLT", "Charlotte", "Charlotte", "NC", 35.2271, -80.8431, "SECONDARY", "Proof benchmark market."),
  us("US-CMH", "Columbus", "Columbus", "OH", 39.9612, -82.9988, "PRIMARY", "Proof benchmark market."),
  us("US-DAL", "Dallas-Fort Worth", "Dallas-Fort Worth", "TX", 32.7767, -96.797, "PRIMARY", "Proof benchmark market."),
  us("US-DEN", "Denver", "Denver", "CO", 39.7392, -104.9903, "PRIMARY", "Proof benchmark market."),
  us("US-HOU", "Houston", "Houston", "TX", 29.7604, -95.3698, "PRIMARY", "Proof benchmark market."),
  us("US-IND", "Indianapolis", "Indianapolis", "IN", 39.7684, -86.1581, "PRIMARY", "Proof benchmark market."),
  us("US-JAX", "Jacksonville", "Jacksonville", "FL", 30.3322, -81.6557, "SECONDARY", "Proof benchmark market."),
  us("US-KC", "Kansas City", "Kansas City", "MO", 39.0997, -94.5786, "PRIMARY", "Proof benchmark market."),
  us("US-LAS", "Las Vegas", "Las Vegas", "NV", 36.1699, -115.1398, "SECONDARY", "Proof benchmark market."),
  us("US-LAX", "Southern California", "Los Angeles", "CA", 34.0522, -118.2437, "PRIMARY", "Proof benchmark market."),
  us("US-MEM", "Memphis", "Memphis", "TN", 35.1495, -90.049, "PRIMARY", "Proof benchmark market."),
  us("US-MIA", "Miami", "Miami", "FL", 25.7617, -80.1918, "SECONDARY", "Proof benchmark market."),
  us("US-MSP", "Minneapolis-St. Paul", "Minneapolis-St. Paul", "MN", 44.9778, -93.265, "PRIMARY", "Proof benchmark market."),
  us("US-NJ", "Northern New Jersey", "Newark", "NJ", 40.7357, -74.1724, "PRIMARY", "Proof benchmark market."),
  us("US-ORL", "Orlando", "Orlando", "FL", 28.5383, -81.3792, "SECONDARY", "Proof benchmark market."),
  us("US-PHX", "Phoenix", "Phoenix", "AZ", 33.4484, -112.074, "PRIMARY", "Proof benchmark market."),
  us("US-RNO", "Reno", "Reno", "NV", 39.5296, -119.8138, "SECONDARY", "Proof benchmark market."),
  us("US-SLC", "Salt Lake City", "Salt Lake City", "UT", 40.7608, -111.891, "PRIMARY", "Proof benchmark market."),
  us("US-STL", "St. Louis", "St. Louis", "MO", 38.627, -90.1994, "PRIMARY", "Proof benchmark market."),
  us("US-SEA", "Seattle", "Seattle", "WA", 47.6062, -122.3321, "PRIMARY", "Proof benchmark market."),
  ca("CA-CGY", "Calgary", "Calgary", "AB", 51.0447, -114.0719),
  ca("CA-HFX", "Halifax", "Halifax", "NS", 44.6488, -63.5752),
  ca("CA-MTL", "Montreal", "Montreal", "QC", 45.5019, -73.5674),
  ca("CA-SAS", "Saskatoon", "Saskatoon", "SK", 52.1579, -106.6702),
  ca("CA-TOR", "Toronto", "Toronto", "ON", 43.6532, -79.3832),
  ca("CA-VAN", "Vancouver", "Vancouver", "BC", 49.2827, -123.1207),
  ca("CA-WPG", "Winnipeg", "Winnipeg", "MB", 49.8951, -97.1384),
  ca("CA-YQM", "Moncton", "Moncton", "NB", 46.0878, -64.7782),
  ca("CA-YYG", "Charlottetown", "Charlottetown", "PE", 46.2382, -63.1311),
  ca("CA-YYT", "St. John's", "St. John's", "NL", 47.5615, -52.7126)
].map((row) => ({ ...row, catalogueVersion: NEWL_LOGISTICS_MARKET_PROOF_CATALOGUE_VERSION }));

export const NEWL_LOGISTICS_MARKET_CATALOGUE: NewlLogisticsMarketCatalogueRow[] = [
  us("US-NJ", "New York / Northern New Jersey", "Newark", "NJ", 40.7357, -74.1724, "PRIMARY", "Dense Northeast import, parcel, and consumption-market gateway."),
  us("US-ALB", "Albany", "Albany", "NY", 42.6526, -73.7562, "SECONDARY", "Upstate New York logistics market for eastern New York and western New England reach."),
  us("US-BUF", "Buffalo", "Buffalo", "NY", 42.8864, -78.8784, "SECONDARY", "Western New York logistics market distinct from Northern New Jersey and Cleveland."),
  us("US-PHL", "Philadelphia / South Jersey", "Philadelphia", "PA", 39.9526, -75.1652, "SECONDARY", "Mid-Atlantic infill market distinct from Northern New Jersey."),
  us("US-CPA", "Harrisburg / Central Pennsylvania", "Harrisburg", "PA", 40.2732, -76.8867, "PRIMARY", "Central Pennsylvania distribution corridor for Northeast and Mid-Atlantic reach."),
  us("US-PIT", "Pittsburgh", "Pittsburgh", "PA", 40.4406, -79.9959, "SECONDARY", "Western Pennsylvania and Appalachian logistics market."),
  us("US-BWI", "Baltimore / Washington", "Baltimore", "MD", 39.2904, -76.6122, "PRIMARY", "Combined Baltimore/Washington regional logistics market."),
  us("US-RIC", "Richmond", "Richmond", "VA", 37.5407, -77.436, "SECONDARY", "Virginia and Mid-Atlantic/Southeast bridge market."),
  us("US-ORF", "Norfolk / Hampton Roads", "Norfolk", "VA", 36.8508, -76.2859, "SECONDARY", "Port-oriented Hampton Roads logistics region."),
  us("US-CLT", "Charlotte", "Charlotte", "NC", 35.2271, -80.8431, "PRIMARY", "Carolinas inland distribution and parcel market."),
  us("US-RDU", "Raleigh / Durham", "Raleigh", "NC", 35.7796, -78.6382, "SECONDARY", "Research Triangle and eastern Carolinas demand market."),
  us("US-ATL", "Atlanta", "Atlanta", "GA", 33.749, -84.388, "PRIMARY", "Major Southeast rail, highway, parcel, and population gateway."),
  us("US-SAV", "Savannah", "Savannah", "GA", 32.0809, -81.0912, "SECONDARY", "Southeast port-proximate import logistics market."),
  us("US-CHS", "Charleston", "Charleston", "SC", 32.7765, -79.9311, "SECONDARY", "Carolinas port-proximate logistics market."),
  us("US-JAX", "Jacksonville", "Jacksonville", "FL", 30.3322, -81.6557, "SECONDARY", "North Florida and Southeast gateway."),
  us("US-ORL", "Orlando", "Orlando", "FL", 28.5383, -81.3792, "SECONDARY", "Central Florida consumption and parcel market."),
  us("US-TPA", "Tampa", "Tampa", "FL", 27.9506, -82.4572, "SECONDARY", "West/Central Florida logistics market."),
  us("US-MIA", "Miami / South Florida", "Miami", "FL", 25.7617, -80.1918, "PRIMARY", "South Florida and Latin America gateway market."),
  us("US-BNA", "Nashville", "Nashville", "TN", 36.1627, -86.7816, "PRIMARY", "Central Southeast distribution market."),
  us("US-MEM", "Memphis", "Memphis", "TN", 35.1495, -90.049, "PRIMARY", "Major air, parcel, rail, and Mississippi corridor market."),
  us("US-MSY", "New Orleans", "New Orleans", "LA", 29.9511, -90.0715, "SECONDARY", "Southern Louisiana and Gulf Coast logistics market."),
  us("US-SDF", "Louisville", "Louisville", "KY", 38.2527, -85.7585, "PRIMARY", "Air-parcel and Ohio Valley logistics market."),
  us("US-CVG", "Cincinnati", "Cincinnati", "OH", 39.1031, -84.512, "SECONDARY", "Ohio Valley logistics market distinct from Columbus/Louisville."),
  us("US-CMH", "Columbus", "Columbus", "OH", 39.9612, -82.9988, "PRIMARY", "Central Ohio and Midwest/East distribution market."),
  us("US-CLE", "Cleveland", "Cleveland", "OH", 41.4993, -81.6944, "SECONDARY", "Northern Ohio/Great Lakes demand market."),
  us("US-DTW", "Detroit", "Detroit", "MI", 42.3314, -83.0458, "PRIMARY", "Automotive and Great Lakes logistics market."),
  us("US-IND", "Indianapolis", "Indianapolis", "IN", 39.7684, -86.1581, "PRIMARY", "Central Midwest highway and parcel distribution market."),
  us("US-CHI", "Chicago", "Chicago", "IL", 41.8781, -87.6298, "PRIMARY", "Major Midwest rail, intermodal, parcel, and population gateway."),
  us("US-MSP", "Minneapolis-Saint Paul", "Minneapolis-Saint Paul", "MN", 44.9778, -93.265, "PRIMARY", "Upper Midwest logistics market."),
  us("US-MKE", "Milwaukee", "Milwaukee", "WI", 43.0389, -87.9065, "SECONDARY", "Wisconsin/upper Midwest market; distinct but near Chicago."),
  us("US-KC", "Kansas City", "Kansas City", "MO", 39.0997, -94.5786, "PRIMARY", "Central U.S. rail and highway distribution market."),
  us("US-STL", "St. Louis", "St. Louis", "MO", 38.627, -90.1994, "PRIMARY", "Central Mississippi and Midwest/South bridge market."),
  us("US-OMA", "Omaha", "Omaha", "NE", 41.2565, -95.9345, "SECONDARY", "Plains logistics market for western Midwest coverage."),
  us("US-DAL", "Dallas-Fort Worth", "Dallas-Fort Worth", "TX", 32.7767, -96.797, "PRIMARY", "Major Texas and South-Central U.S. logistics gateway."),
  us("US-HOU", "Houston", "Houston", "TX", 29.7604, -95.3698, "PRIMARY", "Gulf Coast, port, energy, and Texas consumption market."),
  us("US-AUS", "Austin", "Austin", "TX", 30.2672, -97.7431, "SECONDARY", "Central Texas growth market; kept distinct from Dallas/Houston/San Antonio."),
  us("US-SAT", "San Antonio", "San Antonio", "TX", 29.4241, -98.4936, "SECONDARY", "South Texas and Mexico corridor market."),
  us("US-DEN", "Denver", "Denver", "CO", 39.7392, -104.9903, "PRIMARY", "Mountain West regional logistics market."),
  us("US-SLC", "Salt Lake City", "Salt Lake City", "UT", 40.7608, -111.891, "PRIMARY", "Intermountain West distribution market."),
  us("US-BOI", "Boise", "Boise", "ID", 43.615, -116.2023, "SECONDARY", "Southern Idaho and inland Northwest logistics market."),
  us("US-ABQ", "Albuquerque", "Albuquerque", "NM", 35.0844, -106.6504, "SECONDARY", "Central New Mexico and Southwest logistics market."),
  us("US-PHX", "Phoenix", "Phoenix", "AZ", 33.4484, -112.074, "PRIMARY", "Southwest growth and regional distribution market."),
  us("US-LAS", "Las Vegas", "Las Vegas", "NV", 36.1699, -115.1398, "SECONDARY", "Southwest secondary market; useful for Nevada/Inland West demand."),
  us("US-RNO", "Reno", "Reno", "NV", 39.5296, -119.8138, "SECONDARY", "Western Nevada and eastern Sierra logistics market."),
  us("US-LAX", "Southern California", "Los Angeles", "CA", 34.0522, -118.2437, "PRIMARY", "Greater Los Angeles consumption and port gateway market."),
  us("US-IE", "Inland Empire", "Riverside", "CA", 33.9806, -117.3755, "PRIMARY", "Distinct Southern California warehouse concentration; not combined with Los Angeles."),
  us("US-OAK", "Northern California", "Oakland", "CA", 37.8044, -122.2712, "PRIMARY", "Bay Area/Northern California logistics market."),
  us("US-SAC", "Sacramento", "Sacramento", "CA", 38.5816, -121.4944, "SECONDARY", "Northern California inland distribution market distinct from Bay Area."),
  us("US-PDX", "Portland", "Portland", "OR", 45.5152, -122.6784, "PRIMARY", "Pacific Northwest Oregon/Southwest Washington market."),
  us("US-GEG", "Spokane / Inland Northwest", "Spokane", "WA", 47.6588, -117.426, "SECONDARY", "Eastern Washington, northern Idaho, and inland Northwest logistics market."),
  us("US-SEA", "Seattle / Tacoma", "Seattle", "WA", 47.6062, -122.3321, "PRIMARY", "Puget Sound logistics and consumption market."),
  ca("CA-CGY", "Calgary", "Calgary", "AB", 51.0447, -114.0719),
  ca("CA-EDM", "Edmonton", "Edmonton", "AB", 53.5461, -113.4938),
  ca("CA-HFX", "Halifax", "Halifax", "NS", 44.6488, -63.5752),
  ca("CA-MTL", "Montreal", "Montreal", "QC", 45.5019, -73.5674),
  ca("CA-SAS", "Saskatoon", "Saskatoon", "SK", 52.1579, -106.6702),
  ca("CA-TOR", "Toronto / Southern Ontario", "Toronto", "ON", 43.6532, -79.3832),
  ca("CA-VAN", "Vancouver", "Vancouver", "BC", 49.2827, -123.1207),
  ca("CA-WPG", "Winnipeg", "Winnipeg", "MB", 49.8951, -97.1384),
  ca("CA-YQM", "Moncton", "Moncton", "NB", 46.0878, -64.7782),
  ca("CA-YYG", "Charlottetown", "Charlottetown", "PE", 46.2382, -63.1311),
  ca("CA-YYT", "St. John's", "St. John's", "NL", 47.5615, -52.7126)
];

export const NEWL_CANADA_PROVINCE_MARKET_MAP: Array<{
  provinceCode: string;
  province: string;
  approvedLogisticsMarketId: string;
  approvedMajorCity: string;
}> = [
  { provinceCode: "AB", province: "Alberta", approvedLogisticsMarketId: "CA-CGY", approvedMajorCity: "Calgary" },
  { provinceCode: "BC", province: "British Columbia", approvedLogisticsMarketId: "CA-VAN", approvedMajorCity: "Vancouver" },
  { provinceCode: "MB", province: "Manitoba", approvedLogisticsMarketId: "CA-WPG", approvedMajorCity: "Winnipeg" },
  { provinceCode: "NB", province: "New Brunswick", approvedLogisticsMarketId: "CA-YQM", approvedMajorCity: "Moncton" },
  { provinceCode: "NL", province: "Newfoundland and Labrador", approvedLogisticsMarketId: "CA-YYT", approvedMajorCity: "St. John's" },
  { provinceCode: "NS", province: "Nova Scotia", approvedLogisticsMarketId: "CA-HFX", approvedMajorCity: "Halifax" },
  { provinceCode: "ON", province: "Ontario", approvedLogisticsMarketId: "CA-TOR", approvedMajorCity: "Toronto" },
  { provinceCode: "PE", province: "Prince Edward Island", approvedLogisticsMarketId: "CA-YYG", approvedMajorCity: "Charlottetown" },
  { provinceCode: "QC", province: "Quebec", approvedLogisticsMarketId: "CA-MTL", approvedMajorCity: "Montreal" },
  { provinceCode: "SK", province: "Saskatchewan", approvedLogisticsMarketId: "CA-SAS", approvedMajorCity: "Saskatoon" }
];

function us(
  marketId: string,
  marketName: string,
  representativeMajorCity: string,
  stateProvince: string,
  latitude: number,
  longitude: number,
  tier: "PRIMARY" | "SECONDARY",
  rationale: string
): NewlLogisticsMarketCatalogueRow {
  return {
    marketId,
    marketName,
    representativeMajorCity,
    stateProvince,
    country: "US",
    latitude,
    longitude,
    activeEligible: true,
    tier,
    marketType: "Major logistics market",
    rationale,
    catalogueVersion: NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION
  };
}

function ca(
  marketId: string,
  marketName: string,
  representativeMajorCity: string,
  stateProvince: string,
  latitude: number,
  longitude: number
): NewlLogisticsMarketCatalogueRow {
  return {
    marketId,
    marketName,
    representativeMajorCity,
    stateProvince,
    country: "CA",
    latitude,
    longitude,
    activeEligible: true,
    tier: "CANADA_PROVINCE_LEVEL",
    marketType: "Province-level Canadian market",
    rationale: "Approved province-level Canadian screening market; postal-code precision remains deferred.",
    catalogueVersion: NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION
  };
}
