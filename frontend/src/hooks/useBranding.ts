import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { tenantsService } from '@/services/maps';

const CSS_VARS: Record<string, string> = {
  primary_color: '--brand-primary',
  accent_color:  '--brand-accent',
};

/**
 * Fetches tenant branding when tenantId changes and applies it as CSS
 * custom properties on <html>. Also updates <title> and favicon if provided.
 *
 * Call once in a top-level component (e.g., App).
 */
export function useBranding() {
  const tenantId  = useAuthStore((s) => s.tenantId);
  const branding  = useAuthStore((s) => s.branding);
  const setBranding = useAuthStore((s) => s.setBranding);

  // Fetch branding whenever the active tenant changes
  useEffect(() => {
    if (!tenantId) return;
    tenantsService.getBranding(tenantId).then(setBranding).catch(() => {
      setBranding({});
    });
  }, [tenantId, setBranding]);

  // Apply branding to the DOM
  useEffect(() => {
    const root = document.documentElement;

    // CSS custom properties
    for (const [key, cssVar] of Object.entries(CSS_VARS)) {
      const value = (branding as Record<string, string | undefined>)[key];
      if (value) root.style.setProperty(cssVar, value);
      else       root.style.removeProperty(cssVar);
    }

    // Page title
    if (branding.display_name) {
      document.title = branding.display_name;
    } else {
      document.title = 'Annotated Maps';
    }

    // Favicon
    const faviconLink = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"]'
    );
    if (branding.favicon_url && faviconLink) {
      faviconLink.href = branding.favicon_url;
    }
  }, [branding]);

  return branding;
}
