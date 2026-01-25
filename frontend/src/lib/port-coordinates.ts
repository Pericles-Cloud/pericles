/**
 * Port coordinates lookup table for major shipping ports worldwide.
 * This is used for plotting shipment routes on the Atlas map.
 */

export interface PortCoordinates {
  name: string;
  lat: number;
  lng: number;
  country: string;
  code?: string;
}

// Major shipping ports with coordinates
export const PORT_COORDINATES: Record<string, PortCoordinates> = {
  // United States
  'los angeles': { name: 'Los Angeles', lat: 33.7406, lng: -118.2712, country: 'USA', code: 'USLAX' },
  'long beach': { name: 'Long Beach', lat: 33.7542, lng: -118.2160, country: 'USA', code: 'USLGB' },
  'new york': { name: 'New York/New Jersey', lat: 40.6892, lng: -74.0445, country: 'USA', code: 'USNYC' },
  'newark': { name: 'Newark', lat: 40.6833, lng: -74.1500, country: 'USA', code: 'USNWK' },
  'savannah': { name: 'Savannah', lat: 32.0835, lng: -81.0998, country: 'USA', code: 'USSAV' },
  'houston': { name: 'Houston', lat: 29.7604, lng: -95.3698, country: 'USA', code: 'USHOU' },
  'seattle': { name: 'Seattle', lat: 47.6062, lng: -122.3321, country: 'USA', code: 'USSEA' },
  'tacoma': { name: 'Tacoma', lat: 47.2529, lng: -122.4443, country: 'USA', code: 'USTAC' },
  'oakland': { name: 'Oakland', lat: 37.8044, lng: -122.2712, country: 'USA', code: 'USOAK' },
  'charleston': { name: 'Charleston', lat: 32.7765, lng: -79.9311, country: 'USA', code: 'USCHS' },
  'norfolk': { name: 'Norfolk', lat: 36.8508, lng: -76.2859, country: 'USA', code: 'USORF' },
  'miami': { name: 'Miami', lat: 25.7617, lng: -80.1918, country: 'USA', code: 'USMIA' },
  'baltimore': { name: 'Baltimore', lat: 39.2904, lng: -76.6122, country: 'USA', code: 'USBAL' },

  // China
  'shanghai': { name: 'Shanghai', lat: 31.2304, lng: 121.4737, country: 'China', code: 'CNSHA' },
  'shenzhen': { name: 'Shenzhen', lat: 22.5431, lng: 114.0579, country: 'China', code: 'CNSZX' },
  'ningbo': { name: 'Ningbo-Zhoushan', lat: 29.8683, lng: 121.5440, country: 'China', code: 'CNNGB' },
  'guangzhou': { name: 'Guangzhou', lat: 23.1291, lng: 113.2644, country: 'China', code: 'CNCAN' },
  'qingdao': { name: 'Qingdao', lat: 36.0671, lng: 120.3826, country: 'China', code: 'CNTAO' },
  'tianjin': { name: 'Tianjin', lat: 39.0842, lng: 117.2009, country: 'China', code: 'CNTSN' },
  'hong kong': { name: 'Hong Kong', lat: 22.3193, lng: 114.1694, country: 'Hong Kong', code: 'HKHKG' },
  'xiamen': { name: 'Xiamen', lat: 24.4798, lng: 118.0894, country: 'China', code: 'CNXMN' },
  'dalian': { name: 'Dalian', lat: 38.9140, lng: 121.6147, country: 'China', code: 'CNDLC' },

  // Singapore
  'singapore': { name: 'Singapore', lat: 1.2644, lng: 103.8200, country: 'Singapore', code: 'SGSIN' },

  // South Korea
  'busan': { name: 'Busan', lat: 35.1796, lng: 129.0756, country: 'South Korea', code: 'KRPUS' },

  // Japan
  'tokyo': { name: 'Tokyo', lat: 35.6762, lng: 139.6503, country: 'Japan', code: 'JPTYO' },
  'yokohama': { name: 'Yokohama', lat: 35.4437, lng: 139.6380, country: 'Japan', code: 'JPYOK' },
  'nagoya': { name: 'Nagoya', lat: 35.1815, lng: 136.9066, country: 'Japan', code: 'JPNGO' },
  'kobe': { name: 'Kobe', lat: 34.6901, lng: 135.1956, country: 'Japan', code: 'JPUKB' },
  'osaka': { name: 'Osaka', lat: 34.6937, lng: 135.5023, country: 'Japan', code: 'JPOSA' },

  // Taiwan
  'kaohsiung': { name: 'Kaohsiung', lat: 22.6273, lng: 120.3014, country: 'Taiwan', code: 'TWKHH' },
  'taipei': { name: 'Taipei', lat: 25.0330, lng: 121.5654, country: 'Taiwan', code: 'TWTPE' },

  // Malaysia
  'port klang': { name: 'Port Klang', lat: 3.0020, lng: 101.3910, country: 'Malaysia', code: 'MYPKG' },
  'tanjung pelepas': { name: 'Tanjung Pelepas', lat: 1.3621, lng: 103.5511, country: 'Malaysia', code: 'MYTPP' },

  // Thailand
  'laem chabang': { name: 'Laem Chabang', lat: 13.0838, lng: 100.8831, country: 'Thailand', code: 'THLCH' },
  'bangkok': { name: 'Bangkok', lat: 13.7563, lng: 100.5018, country: 'Thailand', code: 'THBKK' },

  // Vietnam
  'ho chi minh': { name: 'Ho Chi Minh City', lat: 10.8231, lng: 106.6297, country: 'Vietnam', code: 'VNSGN' },
  'hai phong': { name: 'Hai Phong', lat: 20.8449, lng: 106.6881, country: 'Vietnam', code: 'VNHPH' },

  // India
  'mumbai': { name: 'Mumbai', lat: 18.9388, lng: 72.8354, country: 'India', code: 'INBOM' },
  'chennai': { name: 'Chennai', lat: 13.0827, lng: 80.2707, country: 'India', code: 'INMAA' },
  'jawaharlal nehru': { name: 'Jawaharlal Nehru (Nhava Sheva)', lat: 18.9496, lng: 72.9481, country: 'India', code: 'INNSA' },

  // UAE
  'dubai': { name: 'Dubai (Jebel Ali)', lat: 25.0127, lng: 55.0638, country: 'UAE', code: 'AEJEA' },
  'jebel ali': { name: 'Jebel Ali', lat: 25.0127, lng: 55.0638, country: 'UAE', code: 'AEJEA' },

  // Saudi Arabia
  'jeddah': { name: 'Jeddah', lat: 21.4858, lng: 39.1925, country: 'Saudi Arabia', code: 'SAJED' },

  // Egypt
  'port said': { name: 'Port Said', lat: 31.2653, lng: 32.3019, country: 'Egypt', code: 'EGPSD' },

  // Europe - Netherlands
  'rotterdam': { name: 'Rotterdam', lat: 51.9244, lng: 4.4777, country: 'Netherlands', code: 'NLRTM' },
  'amsterdam': { name: 'Amsterdam', lat: 52.3676, lng: 4.9041, country: 'Netherlands', code: 'NLAMS' },

  // Europe - Belgium
  'antwerp': { name: 'Antwerp', lat: 51.2194, lng: 4.4025, country: 'Belgium', code: 'BEANR' },

  // Europe - Germany
  'hamburg': { name: 'Hamburg', lat: 53.5511, lng: 9.9937, country: 'Germany', code: 'DEHAM' },
  'bremerhaven': { name: 'Bremerhaven', lat: 53.5396, lng: 8.5809, country: 'Germany', code: 'DEBRV' },

  // Europe - UK
  'felixstowe': { name: 'Felixstowe', lat: 51.9596, lng: 1.3522, country: 'UK', code: 'GBFXT' },
  'southampton': { name: 'Southampton', lat: 50.9097, lng: -1.4044, country: 'UK', code: 'GBSOU' },
  'london': { name: 'London Gateway', lat: 51.4700, lng: 0.4700, country: 'UK', code: 'GBLON' },

  // Europe - France
  'le havre': { name: 'Le Havre', lat: 49.4944, lng: 0.1079, country: 'France', code: 'FRLEH' },
  'marseille': { name: 'Marseille', lat: 43.2965, lng: 5.3698, country: 'France', code: 'FRMRS' },

  // Europe - Spain
  'valencia': { name: 'Valencia', lat: 39.4699, lng: -0.3763, country: 'Spain', code: 'ESVLC' },
  'barcelona': { name: 'Barcelona', lat: 41.3851, lng: 2.1734, country: 'Spain', code: 'ESBCN' },
  'algeciras': { name: 'Algeciras', lat: 36.1408, lng: -5.4536, country: 'Spain', code: 'ESALG' },

  // Europe - Italy
  'genoa': { name: 'Genoa', lat: 44.4056, lng: 8.9463, country: 'Italy', code: 'ITGOA' },
  'gioia tauro': { name: 'Gioia Tauro', lat: 38.4275, lng: 15.8994, country: 'Italy', code: 'ITGIT' },

  // Europe - Greece
  'piraeus': { name: 'Piraeus', lat: 37.9475, lng: 23.6378, country: 'Greece', code: 'GRPIR' },

  // South America - Brazil
  'santos': { name: 'Santos', lat: -23.9536, lng: -46.3329, country: 'Brazil', code: 'BRSSZ' },

  // South America - Panama
  'colon': { name: 'Colon', lat: 9.3547, lng: -79.9015, country: 'Panama', code: 'PAONX' },
  'balboa': { name: 'Balboa', lat: 8.9619, lng: -79.5698, country: 'Panama', code: 'PABLB' },

  // Mexico
  'manzanillo': { name: 'Manzanillo', lat: 19.0514, lng: -104.3186, country: 'Mexico', code: 'MXZLO' },
  'lazaro cardenas': { name: 'Lazaro Cardenas', lat: 17.9593, lng: -102.1859, country: 'Mexico', code: 'MXLZC' },

  // Australia
  'sydney': { name: 'Sydney', lat: -33.8688, lng: 151.2093, country: 'Australia', code: 'AUSYD' },
  'melbourne': { name: 'Melbourne', lat: -37.8136, lng: 144.9631, country: 'Australia', code: 'AUMEL' },

  // South Africa
  'durban': { name: 'Durban', lat: -29.8587, lng: 31.0218, country: 'South Africa', code: 'ZADUR' },
  'cape town': { name: 'Cape Town', lat: -33.9249, lng: 18.4241, country: 'South Africa', code: 'ZACPT' },
};

/**
 * Find port coordinates by name (case-insensitive, partial match).
 */
export function findPortCoordinates(portName: string | null | undefined): PortCoordinates | null {
  if (!portName) return null;

  const normalizedName = portName.toLowerCase().trim();

  // Try exact match first
  if (PORT_COORDINATES[normalizedName]) {
    return PORT_COORDINATES[normalizedName];
  }

  // Try partial match
  for (const [key, value] of Object.entries(PORT_COORDINATES)) {
    if (normalizedName.includes(key) || key.includes(normalizedName)) {
      return value;
    }
  }

  // Try matching by code
  const byCode = Object.values(PORT_COORDINATES).find(
    (p) => p.code?.toLowerCase() === normalizedName
  );
  if (byCode) return byCode;

  return null;
}

/**
 * Generate a curved path between two points for maritime routes.
 * Uses a simple arc calculation to make routes look more realistic.
 */
export function generateCurvedPath(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  numPoints: number = 50
): Array<{ lat: number; lng: number }> {
  const path: Array<{ lat: number; lng: number }> = [];

  // Calculate the midpoint
  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;

  // Calculate distance to determine curve magnitude
  const latDiff = Math.abs(end.lat - start.lat);
  const lngDiff = Math.abs(end.lng - start.lng);
  const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

  // Curve offset based on distance (more curve for longer routes)
  const curveOffset = Math.min(distance * 0.15, 15);

  // Determine which direction to curve (north for east-west routes)
  const curveLat = midLat + (lngDiff > latDiff ? curveOffset : 0);
  const curveLng = midLng + (latDiff > lngDiff ? curveOffset : 0);

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;

    // Quadratic Bezier curve calculation
    const lat =
      Math.pow(1 - t, 2) * start.lat +
      2 * (1 - t) * t * curveLat +
      Math.pow(t, 2) * end.lat;
    const lng =
      Math.pow(1 - t, 2) * start.lng +
      2 * (1 - t) * t * curveLng +
      Math.pow(t, 2) * end.lng;

    path.push({ lat, lng });
  }

  return path;
}
