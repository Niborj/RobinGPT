import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCredentials } from "@/contexts/credentials-context";
import { useLanguage } from "@/contexts/language-context";
import { useBranding } from "@/contexts/branding-context";
import { useToast } from "@/hooks/use-toast";
import { Key, Mail, Globe, Info, Server, Upload, Trash2, RotateCcw, Palette, Type, ImageIcon, Shield } from "lucide-react";
import robinBirdImage from "@assets/stock_images/robin_bird_c4996c14.jpg";
import { ENDPOINT_META, CATO_ENDPOINTS } from "@/lib/endpoint-utils";

const credentialsSchema = z.object({
  apiEndpoint: z.string().optional().default("aim"),
  apiKey: z.string().min(1, "API key is required"),
  email: z.string().email("Valid email is required"),
  llmProvider: z.enum(["openai", "local"]).default("openai"),
  llmBaseUrl: z.string().optional().default(""),
  llmModel: z.string().optional().default(""),
  openaiApiKey: z.string().optional().default(""),
}).refine(
  (data) => data.llmProvider !== "local" || (data.llmBaseUrl && data.llmBaseUrl.trim().length > 0),
  { message: "Base URL is required for local LLM", path: ["llmBaseUrl"] }
);

type CredentialsFormData = z.infer<typeof credentialsSchema>;

interface CredentialsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function CredentialsSettingsDialog({ open, onOpenChange }: CredentialsSettingsDialogProps) {
  const { credentials, setCredentials } = useCredentials();
  const { setLanguage, t } = useLanguage();
  const { branding, setBranding, resetBranding, isCustomized } = useBranding();
  const { toast } = useToast();
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      toast({ title: t("branding.invalidFileType"), description: t("branding.invalidFileTypeDesc"), variant: "destructive" });
      if (logoFileInputRef.current) logoFileInputRef.current.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: t("branding.fileTooLarge"), description: t("branding.fileTooLargeDesc"), variant: "destructive" });
      if (logoFileInputRef.current) logoFileInputRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setBranding({ logoUrl: result });
        toast({ title: t("branding.updated"), description: t("branding.updatedDesc") });
      }
    };
    reader.onerror = () => {
      toast({ title: t("branding.invalidFileType"), description: t("branding.invalidFileTypeDesc"), variant: "destructive" });
    };
    reader.readAsDataURL(file);
    if (logoFileInputRef.current) logoFileInputRef.current.value = "";
  };

  const form = useForm<CredentialsFormData>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      apiEndpoint: credentials?.apiEndpoint || "aim",
      apiKey: credentials?.apiKey || "",
      email: credentials?.email || "",
      llmProvider: credentials?.llmProvider || "openai",
      llmBaseUrl: credentials?.llmBaseUrl || "",
      llmModel: credentials?.llmModel || "",
      openaiApiKey: credentials?.openaiApiKey || "",
    },
    values: {
      apiEndpoint: credentials?.apiEndpoint || "aim",
      apiKey: credentials?.apiKey || "",
      email: credentials?.email || "",
      llmProvider: credentials?.llmProvider || "openai",
      llmBaseUrl: credentials?.llmBaseUrl || "",
      llmModel: credentials?.llmModel || "",
      openaiApiKey: credentials?.openaiApiKey || "",
    },
  });

  const selectedEndpoint = form.watch("apiEndpoint") || "aim";
  const isCato = selectedEndpoint.startsWith("cato");
  const llmProvider = form.watch("llmProvider");
  const isLocalLlm = llmProvider === "local";

  const isMountRef = useRef(true);

  useEffect(() => {
    if (selectedEndpoint === "cato-jp1") {
      setLanguage("ja");
      if (!isMountRef.current) {
        toast({
          title: "言語を日本語に切り替えました",
          description: "Language switched to Japanese to match your selected regional endpoint.",
        });
      }
    }
    isMountRef.current = false;
  }, [selectedEndpoint, setLanguage, toast]);

  const onSubmit = (data: CredentialsFormData) => {
    try {
      setCredentials({
        apiKey: data.apiKey,
        email: data.email,
        apiEndpoint: data.apiEndpoint,
        llmProvider: data.llmProvider,
        llmBaseUrl: data.llmBaseUrl || undefined,
        llmModel: data.llmModel || undefined,
        openaiApiKey: data.openaiApiKey || undefined,
      });
      onOpenChange(false);
      toast({
        title: t('chat.credentialsUpdated'),
        description: t('chat.credentialsUpdatedDesc'),
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update credentials. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] flex flex-col" data-testid="dialog-settings">
        <DialogHeader>
          <DialogTitle>
            {t('chat.settingsTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('chat.settingsDesc')}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="security" className="flex-1 min-h-0">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="security" className="gap-1.5" data-testid="tab-security">
              <Shield className="w-3.5 h-3.5" />
              <span>{t('chat.tabSecurity')}</span>
            </TabsTrigger>
            <TabsTrigger value="llm" className="gap-1.5" data-testid="tab-llm">
              <Server className="w-3.5 h-3.5" />
              <span>{t('chat.tabLlm')}</span>
            </TabsTrigger>
            <TabsTrigger value="branding" className="gap-1.5" data-testid="tab-branding">
              <Palette className="w-3.5 h-3.5" />
              <span>{t('chat.tabBranding')}</span>
            </TabsTrigger>
          </TabsList>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col mt-4">
              <div className="overflow-y-auto flex-1 min-h-0 pr-1">
                <TabsContent value="security" className="mt-0 space-y-4">
                  <FormField
                    control={form.control}
                    name="apiEndpoint"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Globe className="h-4 w-4" />
                          {t('chat.firewallProvider')}
                        </FormLabel>
                        <FormControl>
                          <Select
                            value={field.value || "aim"}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger data-testid="select-api-endpoint">
                              <SelectValue placeholder={t('chat.selectProvider')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="aim">Aim Security (api.aim.security)</SelectItem>
                              <SelectItem value="cato">Europe (api.aisec.catonetworks.com)</SelectItem>
                              <SelectItem value="cato-us1">US (api.aisec.us1.catonetworks.com)</SelectItem>
                              <SelectItem value="cato-in1">India (api.aisec.in1.catonetworks.com)</SelectItem>
                              <SelectItem value="cato-jp1">Japan (api.aisec.jp1.catonetworks.com)</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          {t('chat.firewallEndpointDesc')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {isCato && (
                    <div className="rounded-md border border-border bg-muted/40 p-3" data-testid="callout-regional-info">
                      <div className="flex gap-2 mb-2">
                        <Info className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          {t('chat.catoRegionInfo')}
                        </p>
                      </div>
                      <div className="space-y-1">
                        {CATO_ENDPOINTS.map((key) => {
                          const meta = ENDPOINT_META[key];
                          const isSelected = key === selectedEndpoint;
                          return (
                            <div key={key} className={`flex items-center gap-3 rounded px-2 py-1 ${isSelected ? "bg-background" : ""}`}>
                              <span className={`text-[11px] font-mono flex-1 truncate ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                {meta.host}
                              </span>
                              <span className={`text-[11px] whitespace-nowrap ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                {meta.region}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="apiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('chat.apiKeyLabel')}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Key className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input
                              {...field}
                              type="password"
                              placeholder={t('chat.apiKeyPlaceholder')}
                              className="pl-9"
                              data-testid="input-api-key"
                            />
                          </div>
                        </FormControl>
                        <FormDescription>
                          {t('chat.firewallApiKeyDesc')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('chat.emailLabel')}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input
                              {...field}
                              type="email"
                              placeholder={t('chat.emailPlaceholder')}
                              className="pl-9"
                              data-testid="input-user-email"
                            />
                          </div>
                        </FormControl>
                        <FormDescription>
                          {t('chat.emailDesc')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>

                <TabsContent value="llm" className="mt-0 space-y-4">
                  <FormField
                    control={form.control}
                    name="llmProvider"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Server className="h-4 w-4" />
                          {t('chat.llmProvider')}
                        </FormLabel>
                        <FormControl>
                          <Select
                            value={field.value || "openai"}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger data-testid="select-llm-provider">
                              <SelectValue placeholder={t('chat.llmProvider')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="openai">{t('chat.llmProviderOpenai')}</SelectItem>
                              <SelectItem value="local">{t('chat.llmProviderLocal')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          {t('chat.llmProviderDesc')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {!isLocalLlm && (
                    <FormField
                      control={form.control}
                      name="openaiApiKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('chat.openaiApiKeyLabel')}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Key className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                              <Input
                                {...field}
                                type="password"
                                placeholder="sk-..."
                                className="pl-9"
                                data-testid="input-openai-api-key"
                              />
                            </div>
                          </FormControl>
                          <FormDescription>
                            {t('chat.openaiApiKeyDesc')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {isLocalLlm && (
                    <>
                      <FormField
                        control={form.control}
                        name="llmBaseUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('chat.llmBaseUrl')}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="url"
                                placeholder={t('chat.llmBaseUrlPlaceholder')}
                                data-testid="input-llm-base-url"
                              />
                            </FormControl>
                            <FormDescription>
                              {t('chat.llmBaseUrlDesc')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="llmModel"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('chat.llmModelName')}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="text"
                                placeholder={t('chat.llmModelPlaceholder')}
                                data-testid="input-llm-model"
                              />
                            </FormControl>
                            <FormDescription>
                              {t('chat.llmModelDesc')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </TabsContent>

                <TabsContent value="branding" className="mt-0 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Type className="w-3.5 h-3.5" />
                      {t("branding.appName")}
                    </label>
                    <Input
                      value={branding.appName}
                      onChange={(e) => setBranding({ appName: e.target.value })}
                      placeholder={t("branding.appNamePlaceholder")}
                      data-testid="input-branding-name"
                    />
                    <p className="text-xs text-muted-foreground">{t("branding.appNameDesc")}</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <ImageIcon className="w-3.5 h-3.5" />
                      {t("branding.logo")}
                    </label>
                    <p className="text-xs text-muted-foreground">{t("branding.logoDesc")}</p>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg overflow-hidden border border-border flex-shrink-0">
                        <img
                          src={branding.logoUrl || robinBirdImage}
                          alt={t("branding.logoPreview")}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <input
                          ref={logoFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={handleLogoUpload}
                          data-testid="input-branding-logo-file"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => logoFileInputRef.current?.click()}
                          data-testid="button-upload-logo"
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          {t("branding.logoUpload")}
                        </Button>
                        {branding.logoUrl && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setBranding({ logoUrl: "" });
                              toast({ title: t("branding.updated"), description: t("branding.updatedDesc") });
                            }}
                            data-testid="button-remove-logo"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t("branding.logoRemove")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Palette className="w-3.5 h-3.5" />
                      {t("branding.primaryColor")}
                    </label>
                    <p className="text-xs text-muted-foreground">{t("branding.primaryColorDesc")}</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={branding.primaryColor || "#3b82f6"}
                        onChange={(e) => setBranding({ primaryColor: e.target.value })}
                        className="w-9 h-9 rounded-md border border-border cursor-pointer"
                        data-testid="input-branding-color"
                      />
                      {branding.primaryColor && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setBranding({ primaryColor: "" });
                            toast({ title: t("branding.updated"), description: t("branding.updatedDesc") });
                          }}
                          data-testid="button-reset-color"
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          {t("branding.resetDefaults")}
                        </Button>
                      )}
                    </div>
                  </div>

                  {isCustomized && (
                    <div className="flex justify-end pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          resetBranding();
                          toast({ title: t("branding.resetDone"), description: t("branding.resetDoneDesc") });
                        }}
                        data-testid="button-reset-branding"
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        {t("branding.resetDefaults")}
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel-settings"
                >
                  {t('chat.cancel')}
                </Button>
                <Button
                  type="submit"
                  size="default"
                  className="min-w-[120px]"
                  data-testid="button-save-settings"
                >
                  {t('chat.saveChanges')}
                </Button>
              </div>
            </form>
          </Form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
