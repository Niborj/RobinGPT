import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { type Language, getTranslation } from '@/lib/i18n';

type LanguageContextType = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string>) => string;
};

const LanguageContext = createContext<LanguageContextType | null>(null);

const STORAGE_KEY = 'robingpt-language';
const BRANDING_STORAGE_KEY = 'robingpt-branding';

function getAppName(): string {
  try {
    const stored = localStorage.getItem(BRANDING_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (typeof parsed.appName === 'string' && parsed.appName.length > 0) {
        return parsed.appName;
      }
    }
  } catch {
    // ignore
  }
  return 'RobinGPT';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ['en', 'fr', 'ja', 'de', 'es'].includes(stored)) {
        return stored as Language;
      }
    }
    return 'en';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string>) => {
    let result = getTranslation(language, key);
    const mergedParams: Record<string, string> = { appName: getAppName(), ...params };
    for (const [k, v] of Object.entries(mergedParams)) {
      result = result.replaceAll(`{{${k}}}`, v);
    }
    return result;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
