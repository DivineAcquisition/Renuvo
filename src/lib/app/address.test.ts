import { describe, expect, it } from "vitest";

import { addressFrom } from "./address";

const c = (longText: string, types: string[], shortText = longText) => ({ longText, shortText, types });

describe("address search: Google's parts become Selestial's fields", () => {
  it("builds the street from number and route, takes the state's short form, and keeps the map location", () => {
    const picked = addressFrom(
      [c("1600", ["street_number"]), c("Amphitheatre Parkway", ["route"], "Amphitheatre Pkwy"), c("Mountain View", ["locality", "political"]), c("California", ["administrative_area_level_1", "political"], "CA"), c("United States", ["country", "political"], "US"), c("94043", ["postal_code"])],
      "abc",
      { latitude: 37.422, longitude: -122.084 },
    );
    expect(picked).toEqual({ line1: "1600 Amphitheatre Parkway", city: "Mountain View", region: "CA", postalCode: "94043", placeId: "abc", lat: 37.422, lng: -122.084 });
  });

  it("puts a unit on line 2, and writes a bare unit number as a unit", () => {
    expect(addressFrom([c("10", ["street_number"]), c("Main St", ["route"]), c("4B", ["subpremise"]), c("Austin", ["locality"]), c("Texas", ["administrative_area_level_1"], "TX"), c("78701", ["postal_code"])], "p").line2).toBe("Unit 4B");
    expect(addressFrom([c("Apt 2", ["subpremise"]), c("Austin", ["locality"])], "p").line2).toBe("Apt 2");
  });

  it("falls back to a borough or town when there is no city, and adds the ZIP+4 when given", () => {
    const picked = addressFrom([c("5", ["street_number"]), c("Court St", ["route"]), c("Brooklyn", ["sublocality_level_1", "sublocality"]), c("New York", ["administrative_area_level_1"], "NY"), c("11201", ["postal_code"]), c("4022", ["postal_code_suffix"])], "p");
    expect(picked.city).toBe("Brooklyn");
    expect(picked.postalCode).toBe("11201-4022");
  });

  it("leaves the map location out rather than saving a wrong one", () => {
    expect(addressFrom([c("Austin", ["locality"])], "p", { latitude: Number.NaN, longitude: 1 })).not.toHaveProperty("lat");
    expect(addressFrom([c("Austin", ["locality"])], "p")).not.toHaveProperty("lng");
  });
});
