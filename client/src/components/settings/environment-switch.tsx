import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Database, Cloud } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function EnvironmentSwitch() {
  return (
    <div className="flex items-center gap-3 bg-muted/30 px-3 py-1.5 rounded-lg border border-border/50">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Database className="h-3.5 w-3.5" />
        <span>Dev</span>
      </div>
      
      <Tooltip>
        <TooltipTrigger asChild>
           <div>
             <Switch id="env-mode" />
           </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Switch to Production Database</p>
        </TooltipContent>
      </Tooltip>

      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Cloud className="h-3.5 w-3.5" />
        <span>Prod</span>
      </div>
    </div>
  );
}