import type { SearchProfileSuggestionOption } from "@/modules/lead-gen/search-profile-suggestions";

const UNITED_STATES_INLAND_PORTS = [
  ["Atlanta, GA", "Atlanta, GA"],
  ["Birmingham, AL", "Birmingham, AL"],
  ["Charlotte, NC", "Charlotte, NC"],
  ["Chicago, IL", "Chicago, IL"],
  ["Cincinnati, OH", "Cincinnati, OH"],
  ["Cleveland, OH", "Cleveland, OH"],
  ["Columbus, OH", "Columbus, OH"],
  ["Dallas, TX", "Dallas, TX"],
  ["Denver, CO", "Denver, CO"],
  ["Detroit, MI", "Detroit, MI"],
  ["El Paso, TX", "El Paso, TX"],
  ["Fort Worth, TX", "Fort Worth, TX"],
  ["Greensboro, NC", "Greensboro, NC"],
  ["Harrisburg, PA", "Harrisburg, PA"],
  ["Houston, TX", "Houston, TX"],
  ["Indianapolis, IN", "Indianapolis, IN"],
  ["Kansas City, MO", "Kansas City, MO"],
  ["Laredo, TX", "Laredo, TX"],
  ["Louisville, KY", "Louisville, KY"],
  ["Memphis, TN", "Memphis, TN"],
  ["Minneapolis, MN", "Minneapolis, MN"],
  ["Nashville, TN", "Nashville, TN"],
  ["Omaha, NE", "Omaha, NE"],
  ["Phoenix, AZ", "Phoenix, AZ"],
  ["Pittsburgh, PA", "Pittsburgh, PA"],
  ["Portland, OR", "Portland, OR"],
  ["Reno, NV", "Reno, NV"],
  ["Salt Lake City, UT", "Salt Lake City, UT"],
  ["San Antonio, TX", "San Antonio, TX"],
  ["St. Louis, MO", "St. Louis, MO"]
] as const;

const CANADA_INLAND_PORTS = [
  ["Brampton, ON", "Brampton, ON"],
  ["Calgary, AB", "Calgary, AB"],
  ["Edmonton, AB", "Edmonton, AB"],
  ["Halifax, NS", "Halifax, NS"],
  ["Hamilton, ON", "Hamilton, ON"],
  ["London, ON", "London, ON"],
  ["Mississauga, ON", "Mississauga, ON"],
  ["Montreal, QC", "Montreal, QC"],
  ["Regina, SK", "Regina, SK"],
  ["Saskatoon, SK", "Saskatoon, SK"],
  ["Toronto, ON", "Toronto, ON"],
  ["Vaughan, ON", "Vaughan, ON"],
  ["Vancouver, BC", "Vancouver, BC"],
  ["Winnipeg, MB", "Winnipeg, MB"]
] as const;

export const NORTH_AMERICA_INLAND_PORT_SUGGESTIONS: SearchProfileSuggestionOption[] = [
  ...UNITED_STATES_INLAND_PORTS.map(([value, label]) => ({
    value,
    label: `${label} | United States (inland)`,
    searchText: `${value} United States US inland rail ramp intermodal dry port`
  })),
  ...CANADA_INLAND_PORTS.map(([value, label]) => ({
    value,
    label: `${label} | Canada (inland)`,
    searchText: `${value} Canada CA inland rail ramp intermodal dry port`
  }))
];
