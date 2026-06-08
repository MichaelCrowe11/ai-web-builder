import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Zap, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BillingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BillingModal({ open, onOpenChange }: BillingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const isPro = user?.plan === "pro";

  const startCheckout = async () => {
    if (!user) {
      toast({ title: "Please sign in first", description: "Create an account to upgrade.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/billing/checkout");
      const { url } = await res.json();
      if (url) window.location.href = url; // redirect to Stripe Checkout
    } catch {
      toast({ title: "Could not start checkout", description: "Please try again.", variant: "destructive" });
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/billing/portal");
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch {
      toast({ title: "Could not open billing", variant: "destructive" });
      setBusy(false);
    }
  };

  const tiers = [
    {
      name: "Free",
      price: "$0",
      description: "For trying things out",
      features: ["5 AI generations/day", "Publish to a free subdomain", "Community support"],
      current: !isPro,
      action: null as null | (() => void),
      cta: "Current plan",
    },
    {
      name: "Pro",
      price: "$29.99",
      description: "For building real websites",
      features: ["Unlimited generations", "Custom domain (soon)", "Export code", "Priority support"],
      current: isPro,
      recommended: true,
      action: isPro ? openPortal : startCheckout,
      cta: isPro ? "Manage subscription" : "Upgrade to Pro",
    },
  ];

  const used = user?.generationsUsed ?? 0;
  const limit = user?.generationsLimit;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-bold text-center">
            {isPro ? "You're on Pro" : "Upgrade your plan"}
          </DialogTitle>
          <DialogDescription className="text-center text-base">
            {isPro ? "Unlimited generations are unlocked." : "Go unlimited and publish without limits."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6 py-6">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-xl border p-6 flex flex-col ${
                tier.recommended ? "border-primary bg-primary/5 shadow-xl" : "border-border bg-card"
              }`}
            >
              {tier.recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                  RECOMMENDED
                </div>
              )}
              <div className="mb-4">
                <h3 className="font-bold text-lg">{tier.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{tier.price}</span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">{tier.description}</p>
              </div>
              <ul className="space-y-3 mb-6 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={tier.current && !tier.action ? "outline" : "default"}
                className="w-full"
                disabled={(tier.current && !tier.action) || busy}
                onClick={() => tier.action?.()}
              >
                {busy && tier.action ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {tier.cta}
              </Button>
            </div>
          ))}
        </div>

        {user && limit != null && (
          <div className="bg-muted/50 rounded-lg p-4 flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-primary" />
            <span>
              Usage today: <strong>{used}/{limit}</strong> generations
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
