import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { CredentialsProvider } from "@/contexts/credentials-context";
import { LanguageProvider } from "@/contexts/language-context";
import { BrandingProvider } from "@/contexts/branding-context";
import { CredentialsModal } from "@/components/credentials-modal";
import Chat from "@/pages/chat";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Chat} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <LanguageProvider>
          <BrandingProvider>
          <CredentialsProvider>
            <TooltipProvider>
              <Toaster />
              <CredentialsModal />
              <Router />
            </TooltipProvider>
          </CredentialsProvider>
          </BrandingProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
