import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Zap, Shield, Globe } from "lucide-react";

interface BillingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BillingModal({ open, onOpenChange }: BillingModalProps) {
  const tiers = [
    {
      name: "Starter",
      price: "$0",
      description: "For hobbyists and prototypes",
      features: ["5 AI Generations/mo", "Public Subdomain", "Community Support"],
      current: true
    },
    {
      name: "Pro",
      price: "$29",
      description: "For professionals and freelancers",
      features: ["Unlimited Generations", "Custom Domain", "Export Code", "Priority Support"],
      current: false,
      recommended: true
    },
    {
      name: "Enterprise",
      price: "Custom",
      description: "For large teams and organizations",
      features: ["SSO & Advanced Security", "SLA", "Dedicated Success Manager", "Private Cloud"],
      current: false
    }
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-bold text-center">Upgrade your workspace</DialogTitle>
          <DialogDescription className="text-center text-lg">
            Choose the plan that fits your needs. Scale as you grow.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid md:grid-cols-3 gap-6 py-6">
          {tiers.map((tier) => (
            <div 
              key={tier.name} 
              className={`relative rounded-xl border p-6 flex flex-col ${
                tier.recommended 
                  ? "border-primary bg-primary/5 shadow-xl scale-105 z-10" 
                  : "border-border bg-card"
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
                  {tier.price !== "Custom" && <span className="text-muted-foreground">/mo</span>}
                </div>
                <p className="text-sm text-muted-foreground mt-2">{tier.description}</p>
              </div>
              
              <ul className="space-y-3 mb-6 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500" />
                    {feature}
                  </li>
                ))}
              </ul>
              
              <Button 
                variant={tier.current ? "outline" : "default"} 
                className="w-full"
                disabled={tier.current}
              >
                {tier.current ? "Current Plan" : "Upgrade"}
              </Button>
            </div>
          ))}
        </div>
        
        <div className="bg-muted/50 rounded-lg p-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <span>Usage this month: <strong>2/5 Generations</strong></span>
          </div>
          <Button variant="link" size="sm">View Billing History</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}