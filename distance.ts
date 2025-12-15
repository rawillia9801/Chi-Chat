// app/distance.ts

const ORIGIN = "Marion, VA";

/**
 * Call Google Directions API and return one–way driving distance in miles.
 * Returns null if we can't get a route.
 */
export async function getDistanceInMiles(destination: string): Promise<number | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_MAPS_API_KEY is not set.");
    return null;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", ORIGIN);
  url.searchParams.set("destination", destination);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error("Google Directions API error:", await res.text());
    return null;
  }

  const data = await res.json();
  const leg = data?.routes?.[0]?.legs?.[0];
  if (!leg || !leg.distance || typeof leg.distance.value !== "number") {
    console.error("No distance found in Directions API response.");
    return null;
  }

  const meters = leg.distance.value as number;
  const miles = meters / 1609.34;
  return miles;
}

/**
 * Apply SWVA Chihuahua mileage policy.
 * First 50 miles free, then $1.25 per mile (one way), $75 minimum for paid trips.
 */
export function calculateDeliveryFee(milesOneWay: number): number {
  if (milesOneWay <= 50) {
    // Inside free zone: $0 delivery fee
    return 0;
  }

  const paidMiles = milesOneWay - 50;
  const fee = paidMiles * 1.25;

  // Any trip outside the free zone has at least $75 delivery fee
  return fee < 75 ? 75 : fee;
}
