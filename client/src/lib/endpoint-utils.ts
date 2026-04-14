export interface EndpointMeta {
  label: string;
  region: string;
  host: string;
  regionNote: string;
}

export const ENDPOINT_META: Record<string, EndpointMeta> = {
  aim: {
    label: "AI Firewall (api.aim.security)",
    region: "Global",
    host: "api.aim.security",
    regionNote: "Aim Security's global management endpoint.",
  },
  cato: {
    label: "Europe (api.aisec.catonetworks.com)",
    region: "Europe",
    host: "api.aisec.catonetworks.com",
    regionNote: "Connects to the Cato AISEC management application in Europe.",
  },
  "cato-us1": {
    label: "US (api.aisec.us1.catonetworks.com)",
    region: "United States",
    host: "api.aisec.us1.catonetworks.com",
    regionNote: "Connects to the Cato AISEC management application in the United States.",
  },
  "cato-in1": {
    label: "India (api.aisec.in1.catonetworks.com)",
    region: "India",
    host: "api.aisec.in1.catonetworks.com",
    regionNote: "Connects to the Cato AISEC management application in India.",
  },
  "cato-jp1": {
    label: "Japan (api.aisec.jp1.catonetworks.com)",
    region: "Japan",
    host: "api.aisec.jp1.catonetworks.com",
    regionNote: "Connects to the Cato AISEC management application in Japan.",
  },
};

export const CATO_ENDPOINTS = ["cato", "cato-us1", "cato-in1", "cato-jp1"] as const;

export function getEndpointLabel(endpointKey: string): string {
  return ENDPOINT_META[endpointKey]?.label ?? `AI Firewall (${endpointKey})`;
}

export function getEndpointShortLabel(endpointKey: string): string {
  if (endpointKey === "aim") return "Aim Security";
  if (endpointKey === "cato") return "Cato AISEC EU";
  if (endpointKey === "cato-us1") return "Cato AISEC US";
  if (endpointKey === "cato-in1") return "Cato AISEC India";
  if (endpointKey === "cato-jp1") return "Cato AISEC Japan";
  return endpointKey;
}

export function isCatoEndpoint(endpointKey: string): boolean {
  return endpointKey.startsWith("cato");
}
