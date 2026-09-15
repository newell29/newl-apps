# 3PL Logistics-Market Catalogue Audit

Evidence status: controlled review for `NEWL_LOGISTICS_MARKETS_V1`.

## Coordinate Standard

Market coordinates use a representative regional logistics city centroid. They are for Haversine regional screening only. They are not warehouse-building, airport, port, road-mile, or carrier-service coordinates.

## Proof Catalogue Audit

The preserved `NEWL_LOGISTICS_MARKETS_PROOF_V1` contains 22 U.S. markets: Atlanta, Chicago, Charlotte, Columbus, Dallas-Fort Worth, Denver, Houston, Indianapolis, Jacksonville, Kansas City, Las Vegas, Southern California, Memphis, Miami, Minneapolis-St. Paul, Northern New Jersey, Orlando, Phoenix, Reno, Salt Lake City, St. Louis, and Seattle.

It contains 10 Canadian province-level markets: Calgary, Halifax, Montreal, Saskatoon, Toronto, Vancouver, Winnipeg, Moncton, Charlottetown, and St. John's.

Overlaps or unclear naming found:

- `Southern California` used Los Angeles as the representative point and did not distinguish the Inland Empire warehouse concentration.
- `Northern New Jersey` represented the broader New York / Northern New Jersey market but the name hid the New York demand-market context.
- `Seattle` did not explicitly indicate the Seattle / Tacoma logistics region.
- `Minneapolis-St. Paul` used a hyphenated spelling; V1 standardizes display to Minneapolis-Saint Paul.

Major practical U.S. regions absent from the proof catalogue included Philadelphia / South Jersey, Harrisburg / Central Pennsylvania, Baltimore / Washington, Richmond, Norfolk / Hampton Roads, Raleigh / Durham, Savannah, Charleston, Tampa, Nashville, Louisville, Cincinnati, Cleveland, Detroit, Milwaukee, Omaha, Austin, San Antonio, Inland Empire, Northern California, Sacramento, and Portland.

## Reviewed Catalogue V1

`NEWL_LOGISTICS_MARKETS_V1` includes 43 active U.S. markets and 11 active Canadian province-level markets.

U.S. markets included:

- New York / Northern New Jersey (`US-NJ`)
- Philadelphia / South Jersey (`US-PHL`)
- Harrisburg / Central Pennsylvania (`US-CPA`)
- Baltimore / Washington (`US-BWI`)
- Richmond (`US-RIC`)
- Norfolk / Hampton Roads (`US-ORF`)
- Charlotte (`US-CLT`)
- Raleigh / Durham (`US-RDU`)
- Atlanta (`US-ATL`)
- Savannah (`US-SAV`)
- Charleston (`US-CHS`)
- Jacksonville (`US-JAX`)
- Orlando (`US-ORL`)
- Tampa (`US-TPA`)
- Miami / South Florida (`US-MIA`)
- Nashville (`US-BNA`)
- Memphis (`US-MEM`)
- Louisville (`US-SDF`)
- Cincinnati (`US-CVG`)
- Columbus (`US-CMH`)
- Cleveland (`US-CLE`)
- Detroit (`US-DTW`)
- Indianapolis (`US-IND`)
- Chicago (`US-CHI`)
- Minneapolis-Saint Paul (`US-MSP`)
- Milwaukee (`US-MKE`)
- Kansas City (`US-KC`)
- St. Louis (`US-STL`)
- Omaha (`US-OMA`)
- Dallas-Fort Worth (`US-DAL`)
- Houston (`US-HOU`)
- Austin (`US-AUS`)
- San Antonio (`US-SAT`)
- Denver (`US-DEN`)
- Salt Lake City (`US-SLC`)
- Phoenix (`US-PHX`)
- Las Vegas (`US-LAS`)
- Southern California (`US-LAX`)
- Inland Empire (`US-IE`)
- Northern California (`US-OAK`)
- Sacramento (`US-SAC`)
- Portland (`US-PDX`)
- Seattle / Tacoma (`US-SEA`)

Canadian markets included:

- Toronto / Southern Ontario (`CA-TOR`)
- Montreal (`CA-MTL`)
- Vancouver (`CA-VAN`)
- Calgary (`CA-CGY`)
- Edmonton (`CA-EDM`)
- Winnipeg (`CA-WPG`)
- Halifax (`CA-HFX`)
- Saskatoon (`CA-SAS`)
- Moncton (`CA-YQM`)
- Charlottetown (`CA-YYG`)
- St. John's (`CA-YYT`)

## Deliberate Combination Or Exclusion Decisions

- New York and Northern New Jersey are combined because they operate as one practical regional import/consumption logistics market at this screening level.
- Baltimore and Washington are combined because this stage screens regional warehouse markets, not local last-mile nodes.
- Southern California and Inland Empire are separated because the Inland Empire is a distinct warehouse-market concentration from Los Angeles/port-proximate Southern California.
- Seattle and Tacoma are combined as one Puget Sound logistics region.
- Philadelphia / South Jersey and Harrisburg / Central Pennsylvania are separated because Central PA is a distinct inland distribution corridor.
- Canadian postal-code precision remains deferred; Canada remains province-level.

## Tier Definitions

- `PRIMARY`: major practical logistics region suitable as a default national/regional candidate.
- `SECONDARY`: practical regional or infill logistics market that should be considered but is generally less nationally central.
- `CANADA_PROVINCE_LEVEL`: approved Canadian province-level screening market.

## Scoring Policy

For `NEWL_LOGISTICS_MARKETS_V1`, the engine scores the full active eligible market catalogue for final one-region and two-region recommendations. Shortlist evidence may still be displayed as explanatory cluster evidence, but it does not limit final scoring in this product stage.
