import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { getStoredCredentials, storeCredentials, clearCredentials, type AimCredentials } from "@/lib/credentials";

interface CredentialsContextType {
  credentials: AimCredentials | null;
  setCredentials: (credentials: AimCredentials) => void;
  clearCredentials: () => void;
  hasCredentials: boolean;
}

const CredentialsContext = createContext<CredentialsContextType | undefined>(undefined);

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentialsState] = useState<AimCredentials | null>(null);

  useEffect(() => {
    const stored = getStoredCredentials();
    if (stored) {
      setCredentialsState(stored);
    }
  }, []);

  const handleSetCredentials = (newCredentials: AimCredentials) => {
    storeCredentials(newCredentials);
    setCredentialsState(newCredentials);
  };

  const handleClearCredentials = () => {
    clearCredentials();
    setCredentialsState(null);
  };

  return (
    <CredentialsContext.Provider
      value={{
        credentials,
        setCredentials: handleSetCredentials,
        clearCredentials: handleClearCredentials,
        hasCredentials: !!credentials,
      }}
    >
      {children}
    </CredentialsContext.Provider>
  );
}

export function useCredentials() {
  const context = useContext(CredentialsContext);
  if (!context) {
    throw new Error("useCredentials must be used within CredentialsProvider");
  }
  return context;
}
