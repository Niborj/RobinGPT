import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

const STORAGE_KEY = "robingpt-branding";

export interface BrandingSettings {
  appName: string;
  logoUrl: string;
  primaryColor: string;
}

const DEFAULT_BRANDING: BrandingSettings = {
  appName: "RobinGPT",
  logoUrl: "",
  primaryColor: "",
};

interface BrandingContextType {
  branding: BrandingSettings;
  setBranding: (settings: Partial<BrandingSettings>) => void;
  resetBranding: () => void;
  isCustomized: boolean;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

function loadBranding(): BrandingSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<BrandingSettings>;
      return { ...DEFAULT_BRANDING, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_BRANDING };
}

function saveBranding(settings: BrandingSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function hslToComponents(hex: string): { h: number; s: number; l: number } | null {
  const result = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function applyPrimaryColor(hex: string) {
  const hsl = hslToComponents(hex);
  if (!hsl) return;
  const value = `${hsl.h} ${hsl.s}% ${hsl.l}%`;
  document.documentElement.style.setProperty("--primary", value);
  document.documentElement.style.setProperty("--ring", value);
  document.documentElement.style.setProperty("--sidebar-primary", value);
  document.documentElement.style.setProperty("--sidebar-ring", value);
}

function clearPrimaryColor() {
  document.documentElement.style.removeProperty("--primary");
  document.documentElement.style.removeProperty("--ring");
  document.documentElement.style.removeProperty("--sidebar-primary");
  document.documentElement.style.removeProperty("--sidebar-ring");
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBrandingState] = useState<BrandingSettings>(loadBranding);

  useEffect(() => {
    if (branding.primaryColor) {
      applyPrimaryColor(branding.primaryColor);
    } else {
      clearPrimaryColor();
    }
  }, [branding.primaryColor]);

  useEffect(() => {
    const name = branding.appName || DEFAULT_BRANDING.appName;
    document.title = `${name} - AI Security Demo`;
  }, [branding.appName]);

  const setBranding = useCallback((partial: Partial<BrandingSettings>) => {
    setBrandingState((prev) => {
      const next = { ...prev, ...partial };
      saveBranding(next);
      return next;
    });
  }, []);

  const resetBranding = useCallback(() => {
    const defaults = { ...DEFAULT_BRANDING };
    saveBranding(defaults);
    setBrandingState(defaults);
    clearPrimaryColor();
  }, []);

  const isCustomized =
    branding.appName !== DEFAULT_BRANDING.appName ||
    branding.logoUrl !== DEFAULT_BRANDING.logoUrl ||
    branding.primaryColor !== DEFAULT_BRANDING.primaryColor;

  return (
    <BrandingContext.Provider value={{ branding, setBranding, resetBranding, isCustomized }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error("useBranding must be used within BrandingProvider");
  }
  return context;
}
